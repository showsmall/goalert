package graphqlapp

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/target/goalert/alert"
	"github.com/target/goalert/alert/alertlog"
	"github.com/target/goalert/assignment"
	"github.com/target/goalert/graphql2"
	"github.com/target/goalert/notification"
	"github.com/target/goalert/permission"
	"github.com/target/goalert/search"
	"github.com/target/goalert/service"
	"github.com/target/goalert/util/timeutil"
	"github.com/target/goalert/validation"
	"github.com/target/goalert/validation/validate"
)

type Alert App
type AlertLogEntry App
type AlertLogEntryState App

func (a *App) Alert() graphql2.AlertResolver { return (*Alert)(a) }

func (a *App) AlertLogEntry() graphql2.AlertLogEntryResolver { return (*AlertLogEntry)(a) }

func (a *AlertLogEntry) ID(ctx context.Context, obj *alertlog.Entry) (int, error) {
	e := *obj
	return e.ID(), nil
}

func (a *AlertLogEntry) Timestamp(ctx context.Context, obj *alertlog.Entry) (*time.Time, error) {
	e := *obj
	t := e.Timestamp()
	return &t, nil
}

func (a *AlertLogEntry) Message(ctx context.Context, obj *alertlog.Entry) (string, error) {
	e := *obj
	return e.String(ctx), nil
}

func notificationStateFromSendResult(s notification.Status, formattedSrc string) *graphql2.NotificationState {
	var status graphql2.NotificationStatus
	switch s.State {
	case notification.StateFailedTemp, notification.StateFailedPerm:
		status = "ERROR"
	case notification.StateSent, notification.StateDelivered:
		status = "OK"
	}

	var prefix string
	switch s.State {
	case notification.StatePending:
		prefix = "Pending"
	case notification.StateSending:
		prefix = "Sending"
	case notification.StateSent:
		prefix = "Sent"
	case notification.StateDelivered:
		prefix = "Delivered"
	case notification.StateFailedTemp, notification.StateFailedPerm:
		prefix = "Failed"
	default:
		prefix = "Unknown"
	}

	details := s.Details
	if details == "" {
		details = prefix
	} else if !strings.EqualFold(prefix, details) {
		details = prefix + ": " + details
	}

	return &graphql2.NotificationState{
		Details:           details,
		Status:            &status,
		FormattedSrcValue: formattedSrc,
	}
}

func (a *AlertLogEntry) escalationState(ctx context.Context, obj *alertlog.Entry) (*graphql2.NotificationState, error) {
	e := *obj

	meta, ok := e.Meta(ctx).(*alertlog.EscalationMetaData)
	if !ok || meta == nil || !meta.NoOneOnCall {
		return nil, nil
	}

	status := graphql2.NotificationStatusWarn
	return &graphql2.NotificationState{
		Details: "No one was on-call",
		Status:  &status,
	}, nil
}

func (a *AlertLogEntry) notificationSentState(ctx context.Context, obj *alertlog.Entry) (*graphql2.NotificationState, error) {
	e := *obj
	meta, ok := e.Meta(ctx).(*alertlog.NotificationMetaData)
	if !ok || meta == nil {
		return nil, nil
	}

	s, err := (*App)(a).FindOneNotificationMessageStatus(ctx, meta.MessageID)
	if err != nil {
		return nil, errors.Wrap(err, "find alert log state")
	}
	if s == nil {
		return nil, nil
	}

	return notificationStateFromSendResult(s.Status, a.FormatDestFunc(ctx, s.DestType, s.SrcValue)), nil
}

func (a *AlertLogEntry) createdState(ctx context.Context, obj *alertlog.Entry) (*graphql2.NotificationState, error) {
	e := *obj
	meta, ok := e.Meta(ctx).(*alertlog.CreatedMetaData)
	if !ok || meta == nil || !meta.EPNoSteps {
		return nil, nil
	}

	status := graphql2.NotificationStatusWarn
	return &graphql2.NotificationState{
		Details: "No escalation policy steps",
		Status:  &status,
	}, nil
}

func (a *AlertLogEntry) State(ctx context.Context, obj *alertlog.Entry) (*graphql2.NotificationState, error) {
	switch obj.Type() {
	case alertlog.TypeCreated:
		return a.createdState(ctx, obj)
	case alertlog.TypeNotificationSent:
		return a.notificationSentState(ctx, obj)
	case alertlog.TypeEscalated:
		return a.escalationState(ctx, obj)
	}
	return nil, nil
}

func (q *Query) Alert(ctx context.Context, alertID int) (*alert.Alert, error) {
	return (*App)(q).FindOneAlert(ctx, alertID)
}

/*
 * Merges favorites and user-specified serviceIDs in opts.FilterByServiceID
 */
func (q *Query) mergeFavorites(ctx context.Context, svcs []string) ([]string, error) {
	targets, err := q.FavoriteStore.FindAll(ctx, permission.UserID(ctx), []assignment.TargetType{assignment.TargetTypeService})
	if err != nil {
		return nil, err
	}

	if len(svcs) == 0 {
		for _, t := range targets {
			svcs = append(svcs, t.TargetID())
		}
	} else {
		// favorites AND serviceIDs
		m := make(map[string]bool, len(svcs))
		for _, o := range svcs {
			m[o] = true
		}
		// empty slice
		svcs = svcs[:0]

		for _, t := range targets {
			if !m[t.TargetID()] {
				continue
			}
			svcs = append(svcs, t.TargetID())
		}
	}

	return svcs, nil
}

// splitRangeByDuration maps each interval of r to an AlertDataPoint based on the given alerts.
// The given alerts are required to be sorted by their CreatedAt field.
func splitRangeByDuration(r timeutil.ISORInterval, alerts []alert.Alert) (result []graphql2.AlertDataPoint) {
	if r.Period.IsZero() {
		// should be handled by ISORInterval parsing/validation, but just in case
		// prefer panic to infinite loop
		panic("duration must not be zero")
	}

	countAlertsUntil := func(ts time.Time) int {
		var count int
		for len(alerts) > 0 {
			if !alerts[0].CreatedAt.Before(ts) {
				break
			}

			count++
			alerts = alerts[1:]
		}
		return count
	}

	// trim alerts
	countAlertsUntil(r.Start)

	ts := r.Start
	end := r.End()
	for ts.Before(end) {
		next := r.Period.AddTo(ts)
		if next.After(end) {
			next = end
		}
		result = append(result, graphql2.AlertDataPoint{
			Timestamp:  ts,
			AlertCount: countAlertsUntil(next),
		})
		ts = next
	}

	return result
}

func (q *Query) AlertMetrics(ctx context.Context, opts graphql2.AlertMetricsOptions) (result []graphql2.AlertDataPoint, err error) {
	err = validate.Many(
		validate.Range("ServiceIDs", len(opts.FilterByServiceID), 1, 1),
	)
	if err != nil {
		return nil, err
	}

	// only daily supported for now
	if opts.RInterval.Period != (timeutil.ISODuration{Days: 1}) {
		return nil, validation.NewFieldError("rInterval", "only daily currently supported")
	}

	if opts.RInterval.Repeat > 30 {
		return nil, validation.NewFieldError("rInterval", "repeat count must be <= 30")
	}

	alerts, err := q.AlertStore.Search(ctx, &alert.SearchOptions{
		Status:    []alert.Status{alert.StatusClosed},
		Before:    opts.RInterval.Start,
		NotBefore: opts.RInterval.End(),
		ServiceFilter: alert.IDFilter{
			IDs:   opts.FilterByServiceID,
			Valid: true,
		},
		Limit: 100,
		Sort:  alert.SortModeDateIDReverse,
	})
	if err != nil {
		return nil, err
	}

	return splitRangeByDuration(opts.RInterval, alerts), nil
}

func (q *Query) Alerts(ctx context.Context, opts *graphql2.AlertSearchOptions) (conn *graphql2.AlertConnection, err error) {
	if opts == nil {
		opts = new(graphql2.AlertSearchOptions)
	}

	var s alert.SearchOptions
	if opts.First != nil {
		s.Limit = *opts.First
	}

	if s.Limit == 0 {
		s.Limit = 15
	}
	if opts.Search != nil {
		s.Search = *opts.Search
	}
	s.Omit = opts.Omit
	if opts.IncludeNotified != nil && *opts.IncludeNotified {
		s.NotifiedUserID = permission.UserID(ctx)
	}

	err = validate.Many(
		validate.Range("ServiceIDs", len(opts.FilterByServiceID), 0, 50),
		validate.Range("First", s.Limit, 1, 100),
	)
	if err != nil {
		return nil, err
	}

	hasCursor := opts.After != nil && *opts.After != ""

	if hasCursor {
		err = search.ParseCursor(*opts.After, &s)
		if err != nil {
			return nil, errors.Wrap(err, "parse cursor")
		}
	} else {
		if opts.FavoritesOnly != nil && *opts.FavoritesOnly {
			s.ServiceFilter.IDs, err = q.mergeFavorites(ctx, opts.FilterByServiceID)
			if err != nil {
				return nil, err
			}
			// used to potentially return an empty array of alerts
			s.ServiceFilter.Valid = true
		} else {
			s.ServiceFilter.IDs = opts.FilterByServiceID
			if s.ServiceFilter.IDs != nil {
				s.ServiceFilter.Valid = true
			}
		}

		for _, f := range opts.FilterByStatus {
			switch f {
			case graphql2.AlertStatusStatusAcknowledged:
				s.Status = append(s.Status, alert.StatusActive)
			case graphql2.AlertStatusStatusUnacknowledged:
				s.Status = append(s.Status, alert.StatusTriggered)
			case graphql2.AlertStatusStatusClosed:
				s.Status = append(s.Status, alert.StatusClosed)
			}
		}
		if opts.Sort != nil {
			switch *opts.Sort {
			case graphql2.AlertSearchSortStatusID:
				s.Sort = alert.SortModeStatusID
			case graphql2.AlertSearchSortDateID:
				s.Sort = alert.SortModeDateID
			case graphql2.AlertSearchSortDateIDReverse:
				s.Sort = alert.SortModeDateIDReverse
			}
		}
		if opts.CreatedBefore != nil {
			s.Before = *opts.CreatedBefore
		}
		if opts.NotCreatedBefore != nil {
			s.NotBefore = *opts.NotCreatedBefore
		}
	}

	s.Limit++

	alerts, err := q.AlertStore.Search(ctx, &s)
	if err != nil {
		return conn, err
	}

	conn = new(graphql2.AlertConnection)
	conn.PageInfo = &graphql2.PageInfo{}
	if len(alerts) == s.Limit {
		conn.PageInfo.HasNextPage = true
		alerts = alerts[:len(alerts)-1]
	}
	conn.Nodes = alerts
	if len(alerts) > 0 {
		s.After.ID = conn.Nodes[len(conn.Nodes)-1].ID
		s.After.Status = conn.Nodes[len(conn.Nodes)-1].Status
		s.After.Created = conn.Nodes[len(conn.Nodes)-1].CreatedAt
		cur, err := search.Cursor(s)
		if err != nil {
			return nil, errors.Wrap(err, "serialize cursor")
		}
		conn.PageInfo.EndCursor = &cur
	}

	return conn, nil
}

func (a *Alert) ID(ctx context.Context, raw *alert.Alert) (string, error) {
	return strconv.Itoa(raw.ID), nil
}
func (a *Alert) Status(ctx context.Context, raw *alert.Alert) (graphql2.AlertStatus, error) {
	switch raw.Status {
	case alert.StatusTriggered:
		return graphql2.AlertStatusStatusUnacknowledged, nil
	case alert.StatusClosed:
		return graphql2.AlertStatusStatusClosed, nil
	case alert.StatusActive:
		return graphql2.AlertStatusStatusAcknowledged, nil
	}
	return "", errors.New("unknown alert status " + string(raw.Status))
}
func (a *Alert) AlertID(ctx context.Context, raw *alert.Alert) (int, error) {
	return raw.ID, nil
}

func (a *Alert) State(ctx context.Context, raw *alert.Alert) (*alert.State, error) {
	return (*App)(a).FindOneAlertState(ctx, raw.ID)
}

func (a *Alert) Service(ctx context.Context, raw *alert.Alert) (*service.Service, error) {
	return (*App)(a).FindOneService(ctx, raw.ServiceID)
}

func (m *Mutation) CreateAlert(ctx context.Context, input graphql2.CreateAlertInput) (*alert.Alert, error) {
	// An alert when created will always have triggered status
	a := &alert.Alert{
		ServiceID: input.ServiceID,
		Summary:   input.Summary,
		Status:    alert.StatusTriggered,
	}

	if input.Details != nil {
		a.Details = *input.Details
	}

	if input.Sanitize != nil && *input.Sanitize {
		a.Summary = validate.SanitizeText(a.Summary, alert.MaxSummaryLength)
		a.Details = validate.SanitizeText(a.Details, alert.MaxDetailsLength)
	}

	return m.AlertStore.Create(ctx, a)
}

func (a *Alert) RecentEvents(ctx context.Context, obj *alert.Alert, opts *graphql2.AlertRecentEventsOptions) (*graphql2.AlertLogEntryConnection, error) {
	if opts == nil {
		opts = new(graphql2.AlertRecentEventsOptions)
	}

	var s alertlog.SearchOptions
	s.FilterAlertIDs = append(s.FilterAlertIDs, obj.ID)

	if opts.After != nil && *opts.After != "" {
		err := search.ParseCursor(*opts.After, &s)
		if err != nil {
			return nil, err
		}
	}

	if opts.Limit != nil {
		s.Limit = *opts.Limit
	}
	if s.Limit == 0 {
		s.Limit = search.DefaultMaxResults
	}

	s.Limit++

	logs, err := a.AlertLogStore.Search(ctx, &s)
	if err != nil {
		return nil, err
	}
	conn := new(graphql2.AlertLogEntryConnection)
	conn.PageInfo = &graphql2.PageInfo{}
	if len(logs) == s.Limit {
		logs = logs[:len(logs)-1]
		conn.PageInfo.HasNextPage = true
	}
	if len(logs) > 0 {
		last := logs[len(logs)-1]
		s.After.ID = last.ID()
		cur, err := search.Cursor(s)
		if err != nil {
			return nil, err
		}
		conn.PageInfo.EndCursor = &cur
	}
	conn.Nodes = logs
	return conn, err
}

// PendingNotifications returns a list of notifications that are waiting to be sent
func (a *Alert) PendingNotifications(ctx context.Context, obj *alert.Alert) ([]graphql2.AlertPendingNotification, error) {
	var result []graphql2.AlertPendingNotification

	if obj.Status != alert.StatusTriggered {
		return result, nil
	}

	p, err := a.NotificationStore.FindPendingNotifications(ctx, obj.ID)
	if err != nil {
		return nil, err
	}

	for _, val := range p {
		result = append(result, graphql2.AlertPendingNotification{
			Destination: val.DestName + " (" + val.DestType + ")",
		})
	}

	return result, nil
}

func (m *Mutation) EscalateAlerts(ctx context.Context, ids []int) ([]alert.Alert, error) {
	ids, err := m.AlertStore.EscalateMany(ctx, ids)
	if err != nil {
		return nil, err
	}

	return m.AlertStore.FindMany(ctx, ids)
}

func (m *Mutation) UpdateAlerts(ctx context.Context, args graphql2.UpdateAlertsInput) ([]alert.Alert, error) {
	var status alert.Status

	err := validate.OneOf("Status", args.NewStatus, graphql2.AlertStatusStatusAcknowledged, graphql2.AlertStatusStatusClosed)
	if err != nil {
		return nil, err
	}

	switch args.NewStatus {
	case graphql2.AlertStatusStatusAcknowledged:
		status = alert.StatusActive
	case graphql2.AlertStatusStatusClosed:
		status = alert.StatusClosed
	}

	var updatedIDs []int
	updatedIDs, err = m.AlertStore.UpdateManyAlertStatus(ctx, status, args.AlertIDs)
	if err != nil {
		return nil, err
	}

	return m.AlertStore.FindMany(ctx, updatedIDs)
}

func (m *Mutation) UpdateAlertsByService(ctx context.Context, args graphql2.UpdateAlertsByServiceInput) (bool, error) {
	var status alert.Status

	switch args.NewStatus {
	case graphql2.AlertStatusStatusAcknowledged:
		status = alert.StatusActive
	case graphql2.AlertStatusStatusClosed:
		status = alert.StatusClosed
	}

	err := m.AlertStore.UpdateStatusByService(ctx, args.ServiceID, status)
	if err != nil {
		return false, err
	}

	return true, nil
}

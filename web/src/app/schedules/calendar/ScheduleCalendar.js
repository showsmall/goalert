import React, { useContext } from 'react'
import { PropTypes as p } from 'prop-types'
import { Card, Button } from '@mui/material'
import makeStyles from '@mui/styles/makeStyles'
import { darken, useTheme } from '@mui/material/styles'
import Grid from '@mui/material/Grid'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { Calendar } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import ScheduleCalendarEventWrapper from './ScheduleCalendarEventWrapper'
import ScheduleCalendarToolbar from './ScheduleCalendarToolbar'
import { useResetURLParams, useURLParam } from '../../actions'
import { DateTime, Interval } from 'luxon'
import LuxonLocalizer from '../../util/LuxonLocalizer'
import { parseInterval, trimSpans } from '../../util/shifts'
import _ from 'lodash'
import GroupAdd from '@mui/icons-material/GroupAdd'
import { AccountSwitch, AccountMinus, AccountPlus } from 'mdi-material-ui'
import FilterContainer from '../../util/FilterContainer'
import { UserSelect } from '../../selection'
import SpinContainer from '../../loading/components/SpinContainer'
import { useCalendarNavigation } from './hooks'
import { ScheduleCalendarContext } from '../ScheduleDetails'

const localizer = LuxonLocalizer(DateTime, { firstDayOfWeek: 0 })

const useStyles = makeStyles((theme) => ({
  card: {
    padding: theme.spacing(2),
  },
  filterBtn: {
    marginRight: theme.spacing(1.75),
  },
  tempSchedBtn: {
    marginLeft: theme.spacing(1.75),
  },
  overrideTitleIcon: {
    verticalAlign: 'middle',
    borderRadius: '50%',
    background: theme.palette.secondary.main,
    padding: '3px',
    height: '100%',
    width: '18px',
    marginRight: '0.25rem',
  },
}))

function ScheduleCalendar(props) {
  const classes = useStyles()
  const theme = useTheme()

  const { setOverrideDialog } = useContext(ScheduleCalendarContext)

  const { weekly, start } = useCalendarNavigation()

  const [activeOnly, setActiveOnly] = useURLParam('activeOnly', false)
  const [userFilter, setUserFilter] = useURLParam('userFilter', [])
  const resetFilter = useResetURLParams('userFilter', 'activeOnly')

  const { shifts, temporarySchedules } = props

  const eventStyleGetter = (event, start, end, isSelected) => {
    const green = '#0C6618'
    const lavender = '#BB7E8C'

    if (event.fixed) {
      return {
        style: {
          backgroundColor: isSelected ? darken(green, 0.3) : green,
          borderColor: darken(green, 0.3),
        },
      }
    }
    if (event.isOverride) {
      return {
        style: {
          backgroundColor: isSelected ? darken(lavender, 0.3) : lavender,
          borderColor: darken(lavender, 0.3),
        },
      }
    }
  }

  const dayStyleGetter = (date) => {
    const outOfBounds =
      DateTime.fromISO(start).month !== DateTime.fromJSDate(date).month
    const currentDay = DateTime.local().hasSame(
      DateTime.fromJSDate(date),
      'day',
    )

    if (theme.palette.mode === 'dark' && (outOfBounds || currentDay)) {
      return {
        style: {
          backgroundColor: theme.palette.background.default,
        },
      }
    }
  }

  const getOverrideTitle = (o) => {
    if (o.addUser && o.removeUser) {
      // replace override
      return (
        <div>
          <AccountSwitch
            fontSize='small'
            className={classes.overrideTitleIcon}
            aria-label='Replace Override'
          />
          Override
        </div>
      )
    }
    if (o.addUser) {
      // add override
      return (
        <div>
          <AccountPlus
            fontSize='small'
            className={classes.overrideTitleIcon}
            aria-label='Add Override'
          />
          Override
        </div>
      )
    }
    return (
      // remove override
      <div>
        <AccountMinus
          fontSize='small'
          className={classes.overrideTitleIcon}
          aria-label='Remove Override'
        />
        Override
      </div>
    )
  }

  const getCalEvents = (shifts, _tempScheds, userOverrides) => {
    const tempSchedules = _tempScheds.map((sched) => ({
      start: sched.start,
      end: sched.end,
      user: { name: 'Temporary Schedule' },
      tempSched: sched,
      fixed: true,
    }))

    const overrides = userOverrides.map((o) => ({
      user: {
        name: getOverrideTitle(o),
      },
      start: o.start,
      end: o.end,
      fixed: false,
      isTempSchedShift: false,
      tempSched: false,
      isOverride: true,
      override: o,
    }))

    // flat list of all fixed shifts, with `fixed` set to true
    const fixedShifts = _.flatten(
      _tempScheds.map((sched) => {
        return sched.shifts.map((s) => ({
          ...s,
          tempSched: sched,
          fixed: true,
          isTempSchedShift: true,
        }))
      }),
    )

    const fixedIntervals = tempSchedules.map((t) => parseInterval(t, 'local'))
    let filteredShifts = [
      ...tempSchedules,
      ...fixedShifts,
      ...overrides,

      // Remove shifts within a temporary schedule, and trim any that overlap
      ...trimSpans(shifts, fixedIntervals, 'local'),
    ]

    // if any users in users array, only show the ids present
    if (userFilter.length > 0) {
      filteredShifts = filteredShifts.filter((shift) =>
        userFilter.includes(shift.user.id),
      )
    }

    if (activeOnly) {
      filteredShifts = filteredShifts.filter(
        (shift) =>
          shift.TempSched ||
          Interval.fromDateTimes(
            DateTime.fromISO(shift.start),
            DateTime.fromISO(shift.end),
          ).contains(DateTime.local()),
      )
    }

    return filteredShifts.map((shift) => {
      return {
        title: shift.user.name,
        userID: shift.user.id,
        start: new Date(shift.start),
        end: new Date(shift.end),
        fixed: shift.fixed,
        isTempSchedShift: shift.isTempSchedShift,
        tempSched: shift.tempSched,
        isOverride: shift.isOverride,
        override: shift.override,
      }
    })
  }

  return (
    <React.Fragment>
      <Typography variant='caption' color='textSecondary'>
        <i>
          Times shown are in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </i>
      </Typography>
      <Card className={classes.card} data-cy='calendar'>
        <ScheduleCalendarToolbar
          filter={
            <FilterContainer
              onReset={resetFilter}
              iconButtonProps={{
                size: 'small',
                className: classes.filterBtn,
              }}
            >
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={activeOnly}
                      onChange={(e) => setActiveOnly(e.target.checked)}
                      value='activeOnly'
                    />
                  }
                  label='Active shifts only'
                />
              </Grid>
              <Grid item xs={12}>
                <UserSelect
                  label='Filter users...'
                  multiple
                  value={userFilter}
                  onChange={setUserFilter}
                />
              </Grid>
            </FilterContainer>
          }
          endAdornment={
            <Button
              variant='contained'
              color='primary'
              data-cy='new-override'
              onClick={() =>
                setOverrideDialog({
                  variantOptions: ['replace', 'remove', 'add', 'temp'],
                  removeUserReadOnly: false,
                })
              }
              className={classes.tempSchedBtn}
              startIcon={<GroupAdd />}
              title='Make temporary change to schedule'
            >
              Override
            </Button>
          }
        />
        <SpinContainer loading={props.loading}>
          <Calendar
            date={DateTime.fromISO(start).toJSDate()}
            localizer={localizer}
            events={getCalEvents(shifts, temporarySchedules, props.overrides)}
            style={{
              height: weekly ? '100%' : '45rem',
              fontFamily: theme.typography.body2.fontFamily,
              fontSize: theme.typography.body2.fontSize,
            }}
            tooltipAccessor={() => null}
            views={['month', 'week']}
            view={weekly ? 'week' : 'month'}
            showAllEvents
            eventPropGetter={eventStyleGetter}
            dayPropGetter={dayStyleGetter}
            onNavigate={() => {}} // stub to hide false console err
            onView={() => {}} // stub to hide false console err
            components={{
              eventWrapper: ScheduleCalendarEventWrapper,
              toolbar: () => null,
            }}
          />
        </SpinContainer>
      </Card>
    </React.Fragment>
  )
}

ScheduleCalendar.propTypes = {
  scheduleID: p.string.isRequired,
  shifts: p.array.isRequired,
  overrides: p.array.isRequired,
  temporarySchedules: p.array,
  loading: p.bool,
}

export default ScheduleCalendar

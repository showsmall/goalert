import React from 'react'
import p from 'prop-types'
import Typography from '@mui/material/Typography'
import { Switch, Route, useParams } from 'react-router-dom'
import makeStyles from '@mui/styles/makeStyles'
import { ChevronRight } from '@mui/icons-material'
import { gql, useQuery } from '@apollo/client'
import { startCase } from 'lodash'
import AppLink from '../../util/AppLink'
import { useIsWidthDown } from '../../util/useWidth'
import { useConfigValue } from '../../util/RequireConfig'
import { applicationName as appName } from '../../env'

const useStyles = makeStyles(() => ({
  backPage: {
    '&:hover': {
      cursor: 'pointer',
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      borderRadius: '6px',
      padding: '4px',
      textDecoration: 'none',
    },
    padding: '0 4px 0 4px',
  },
  div: {
    alignItems: 'center',
    display: 'flex',
    height: '100%',
    width: '100%',
  },
  title: {
    padding: '0 4px 0 4px',
    flex: 1, // pushes toolbar actions to the right
    fontSize: '1.25rem',
  },
}))

const mapSingular = {
  Schedules: 'Schedule',
  'Escalation Policies': 'Escalation Policy',
  Rotations: 'Rotation',
  Users: 'User',
  Services: 'Service',
}

const queries = {
  users: gql`
    query ($id: ID!) {
      data: user(id: $id) {
        id
        name
      }
    }
  `,
  services: gql`
    query ($id: ID!) {
      data: service(id: $id) {
        id
        name
      }
    }
  `,
  schedules: gql`
    query ($id: ID!) {
      data: schedule(id: $id) {
        id
        name
      }
    }
  `,
  'escalation-policies': gql`
    query ($id: ID!) {
      data: escalationPolicy(id: $id) {
        id
        name
      }
    }
  `,
}

function NameLoader(props) {
  const { data } = useQuery(props.query, {
    variables: { id: props.id },
    skip: !props.id,
  })
  return data?.data?.name ?? props.fallback
}

NameLoader.propTypes = {
  fallback: p.string.isRequired,
  id: p.string,
  query: p.object.isRequired,
}

function ToolbarTitle() {
  const fullScreen = useIsWidthDown('md')
  const classes = useStyles()
  const [applicationName] = useConfigValue('General.ApplicationName')

  const renderTitle = (title) => {
    document.title = `${applicationName || appName} - ${title}`

    return (
      <Typography
        className={classes.title}
        color='inherit'
        noWrap
        component='h1'
      >
        {title.replace('On Call', 'On-Call')}
      </Typography>
    )
  }

  const detailsText = (type) => {
    const typeName = startCase(type)
    return (
      (mapSingular[typeName] || typeName) +
      (type !== 'profile' ? ' Details' : '')
    )
  }

  function SubPageTitle() {
    const { sub: _sub, type, id } = useParams()
    const sub = startCase(_sub)

    if (fullScreen) {
      // mobile, only render current title
      return renderTitle(sub)
    }
    const query = queries[type]

    return (
      <div className={classes.div}>
        <Typography
          component={AppLink}
          className={classes.backPage}
          color='inherit'
          noWrap
          variant='h6'
          to='..'
        >
          {query ? (
            <NameLoader id={id} query={query} fallback={detailsText(type)} />
          ) : (
            detailsText(type)
          )}
        </Typography>
        <ChevronRight />
        {renderTitle(sub)}
      </div>
    )
  }

  function DetailsPageTitle() {
    const { type } = useParams()
    return renderTitle(detailsText(type))
  }

  function TopLevelTitle() {
    const { type } = useParams()
    return renderTitle(startCase(type))
  }

  return (
    <Switch>
      <Route
        path='/:type(escalation-policies)/:id/:sub(services)'
        component={SubPageTitle}
      />
      <Route
        path='/:type(services)/:id/:sub(alerts|integration-keys|heartbeat-monitors|labels|alert-metrics)'
        component={SubPageTitle}
      />
      <Route
        path='/:type(users)/:id/:sub(on-call-assignments|schedule-calendar-subscriptions|sessions)'
        component={SubPageTitle}
      />
      <Route
        path='/:type(profile)/:sub(on-call-assignments|schedule-calendar-subscriptions|sessions)'
        component={SubPageTitle}
      />
      <Route
        path='/:type(schedules)/:id/:sub(assignments|on-call-notifications|escalation-policies|overrides|shifts)'
        component={SubPageTitle}
      />
      <Route
        path='/:type(alerts|rotations|schedules|escalation-policies|services|users)/:id'
        component={DetailsPageTitle}
      />
      <Route
        path='/:type(alerts|rotations|schedules|escalation-policies|services|users|profile)'
        component={TopLevelTitle}
      />
      <Route path='/wizard' render={() => renderTitle('Setup Wizard')} />
      <Route path='/admin' render={() => renderTitle('Admin Page')} />
      <Route path='/docs' render={() => renderTitle('Documentation')} />
    </Switch>
  )
}

export default ToolbarTitle

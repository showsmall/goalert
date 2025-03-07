import React from 'react'
import { PropTypes as p } from 'prop-types'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import makeStyles from '@mui/styles/makeStyles'
import { styles as globalStyles } from '../../styles/materialStyles'
import {
  Build as WizardIcon,
  Feedback as FeedbackIcon,
  Group as UsersIcon,
  Layers as EscalationPoliciesIcon,
  Notifications as AlertsIcon,
  PowerSettingsNew as LogoutIcon,
  RotateRight as RotationsIcon,
  Today as SchedulesIcon,
  VpnKey as ServicesIcon,
  Settings as AdminIcon,
} from '@mui/icons-material'

import routeConfig, { getPath } from '../routes'

import { NavLink } from 'react-router-dom'
import ListItemIcon from '@mui/material/ListItemIcon'
import { useTheme } from '@mui/material/styles'
import { CurrentUserAvatar } from '../../util/avatars'
import { authLogout } from '../../actions'
import { useDispatch } from 'react-redux'
import RequireConfig, { Config } from '../../util/RequireConfig'
import NavSubMenu from './NavSubMenu'
import logo from '../../public/goalert-alt-logo.png'
import darkModeLogo from '../../public/goalert-alt-logo-white.png'
import AppLink from '../../util/AppLink'

const navIcons = {
  Alerts: AlertsIcon,
  Rotations: RotationsIcon,
  Schedules: SchedulesIcon,
  'Escalation Policies': EscalationPoliciesIcon,
  Services: ServicesIcon,
  Users: UsersIcon,
  Admin: AdminIcon,
}

const useStyles = makeStyles((theme) => ({
  ...globalStyles(theme),
  logoDiv: {
    ...theme.mixins.toolbar,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navIcon: {
    width: '1em',
    height: '1em',
    fontSize: '24px',
  },
  list: {
    padding: 0,
  },
}))

export default function SideBarDrawerList(props) {
  const { closeMobileSidebar } = props
  const classes = useStyles()
  const theme = useTheme()
  const dispatch = useDispatch()
  const logout = () => dispatch(authLogout(true))

  function renderSidebarItem(IconComponent, label) {
    return (
      <ListItem button tabIndex={-1}>
        <ListItemIcon>
          <IconComponent className={classes.navIcon} />
        </ListItemIcon>
        <ListItemText
          disableTypography
          primary={
            <Typography variant='subtitle1' component='p'>
              {label}
            </Typography>
          }
        />
      </ListItem>
    )
  }

  function renderSidebarLink(icon, path, label, props = {}) {
    return (
      <AppLink to={path} className={classes.nav} {...props}>
        {renderSidebarItem(icon, label)}
      </AppLink>
    )
  }

  function renderSidebarNavLink(icon, path, label, key) {
    return (
      <NavLink
        key={key}
        to={path}
        className={classes.nav}
        activeClassName={classes.navSelected}
        onClick={closeMobileSidebar}
      >
        {renderSidebarItem(icon, label)}
      </NavLink>
    )
  }

  function renderAdmin() {
    const cfg = routeConfig.find((c) => c.title === 'Admin')

    return (
      <NavSubMenu
        parentIcon={navIcons[cfg.title]}
        parentTitle={cfg.title}
        path={getPath(cfg)}
        subMenuRoutes={cfg.subRoutes}
        closeMobileSidebar={closeMobileSidebar}
      >
        {renderSidebarItem(navIcons[cfg.title], cfg.title)}
      </NavSubMenu>
    )
  }

  function renderFeedback(url) {
    return (
      <AppLink to={url} className={classes.nav} newTab data-cy='feedback-link'>
        {renderSidebarItem(FeedbackIcon, 'Feedback')}
      </AppLink>
    )
  }

  return (
    <React.Fragment>
      <div aria-hidden className={classes.logoDiv}>
        <img
          height={38}
          src={theme.palette.mode === 'dark' ? darkModeLogo : logo}
          alt='GoAlert Logo'
        />
      </div>
      <Divider />
      <nav>
        <List role='navigation' className={classes.list} data-cy='nav-list'>
          {routeConfig
            .filter((cfg) => cfg.nav !== false)
            .map((cfg, idx) => {
              if (cfg.subRoutes) {
                return (
                  <NavSubMenu
                    key={idx}
                    parentIcon={navIcons[cfg.title]}
                    parentTitle={cfg.title}
                    path={getPath(cfg)}
                    subMenuRoutes={cfg.subRoutes}
                  >
                    {renderSidebarItem(navIcons[cfg.title], cfg.title)}
                  </NavSubMenu>
                )
              }
              return renderSidebarNavLink(
                navIcons[cfg.title],
                getPath(cfg),
                cfg.title,
                idx,
              )
            })}
          <RequireConfig isAdmin>
            <Divider aria-hidden />
            {renderAdmin()}
          </RequireConfig>

          <Divider aria-hidden />
          {renderSidebarNavLink(WizardIcon, '/wizard', 'Wizard')}
          <Config>
            {(cfg) =>
              cfg['Feedback.Enable'] &&
              renderFeedback(
                cfg['Feedback.OverrideURL'] ||
                  'https://www.surveygizmo.com/s3/4106900/GoAlert-Feedback',
              )
            }
          </Config>
          {renderSidebarLink(LogoutIcon, '/api/v2/identity/logout', 'Logout', {
            onClick: (e) => {
              e.preventDefault()
              logout()
            },
          })}
          {renderSidebarNavLink(CurrentUserAvatar, '/profile', 'Profile')}
        </List>
      </nav>
    </React.Fragment>
  )
}

SideBarDrawerList.propTypes = {
  closeMobileSidebar: p.func.isRequired,
}

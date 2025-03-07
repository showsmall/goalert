import React, { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Redirect, useParams } from 'react-router-dom'
import _ from 'lodash'
import { Edit, Delete } from '@mui/icons-material'

import PolicyStepsQuery from './PolicyStepsQuery'
import PolicyDeleteDialog from './PolicyDeleteDialog'
import { QuerySetFavoriteButton } from '../util/QuerySetFavoriteButton'
import CreateFAB from '../lists/CreateFAB'
import PolicyStepCreateDialog from './PolicyStepCreateDialog'
import DetailsPage from '../details/DetailsPage'
import PolicyEditDialog from './PolicyEditDialog'
import { useResetURLParams, useURLParam } from '../actions'
import { GenericError, ObjectNotFound } from '../error-pages'
import Spinner from '../loading/components/Spinner'
import { EPAvatar } from '../util/avatars'

const query = gql`
  query ($id: ID!) {
    escalationPolicy(id: $id) {
      id
      name
      description

      notices {
        type
        message
        details
      }
    }
  }
`

export default function PolicyDetails() {
  const { escalationPolicyID } = useParams()
  const stepNumParam = 'createStep'
  const [createStep, setCreateStep] = useURLParam(stepNumParam, false)
  const resetCreateStep = useResetURLParams(stepNumParam)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)

  const {
    loading,
    error,
    data: _data,
  } = useQuery(query, {
    variables: {
      id: escalationPolicyID,
    },
  })

  const data = _.get(_data, 'escalationPolicy', null)

  if (!data && loading) return <Spinner />
  if (error) return <GenericError error={error.message} />

  if (!data) {
    return showDeleteDialog ? (
      <Redirect to='/escalation-policies' push />
    ) : (
      <ObjectNotFound />
    )
  }

  return (
    <React.Fragment>
      <DetailsPage
        notices={data.notices}
        avatar={<EPAvatar />}
        title={data.name}
        details={data.description}
        pageContent={<PolicyStepsQuery escalationPolicyID={data.id} />}
        secondaryActions={[
          {
            label: 'Edit',
            icon: <Edit />,
            handleOnClick: () => setShowEditDialog(true),
          },
          {
            label: 'Delete',
            icon: <Delete />,
            handleOnClick: () => setShowDeleteDialog(true),
          },
          <QuerySetFavoriteButton
            key='secondary-action-favorite'
            id={data.id}
            type='escalationPolicy'
          />,
        ]}
        links={[
          {
            label: 'Services',
            url: 'services',
            subText: 'Find services that link to this policy',
          },
        ]}
      />
      <CreateFAB onClick={() => setCreateStep(true)} title='Create Step' />
      {createStep && (
        <PolicyStepCreateDialog
          escalationPolicyID={data.id}
          onClose={resetCreateStep}
        />
      )}
      {showEditDialog && (
        <PolicyEditDialog
          escalationPolicyID={data.id}
          onClose={() => setShowEditDialog(false)}
        />
      )}
      {showDeleteDialog && (
        <PolicyDeleteDialog
          escalationPolicyID={data.id}
          onClose={() => setShowDeleteDialog(false)}
        />
      )}
    </React.Fragment>
  )
}

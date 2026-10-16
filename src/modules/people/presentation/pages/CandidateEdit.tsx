import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import CandidateForm from "@/components/candidates/CandidateForm"

const CandidateEdit = () => {
  const { entityId, candidateId } = useParams<{ entityId: string; candidateId: string }>()
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()

  const handleSuccess = () => {
    // Success is handled in the form component
  }

  const handleCancel = () => {
    navigate(`/entity/${entityId}/candidates/${candidateId}`)
  }

  if (!entityId || !candidateId) {
    navigate(`/entity/${entityId}/candidates`)
    return null
  }

  return (
    <div className="space-y-6 p-6">
      <CandidateForm
        candidateId={candidateId}
        entityId={entityId}
        mode="edit"
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}

export default CandidateEdit
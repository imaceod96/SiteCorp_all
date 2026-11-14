import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useActiveEntityId } from "@/contexts/CurrentEntityContext"
import CandidateForm from "@/modules/people/presentation/components/CandidateForm"

const CandidateEdit = () => {
  const { candidateId } = useParams<{ candidateId: string }>()
  const entityId = useActiveEntityId()
  const navigate = useNavigate()

  const handleSuccess = () => {
    // Success is handled in the form component
  }

  const handleCancel = () => {
    navigate(candidateId ? `/candidates/${candidateId}` : "/candidates")
  }

  if (!entityId || !candidateId) {
    navigate("/candidates")
    return null
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
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
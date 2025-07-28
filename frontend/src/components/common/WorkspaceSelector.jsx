import React from 'react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

function WorkspaceSelector({ className }) {
  const { workspaces, selectedWorkspace, selectWorkspace, loading } = useWorkspace();

  if (loading) {
    return (
      <div className={`workspace-selector ${className || ''}`}>
        <div className="workspace-dropdown-loading">Loading workspaces...</div>
      </div>
    );
  }

  return (
    <div className={`workspace-selector ${className || ''}`}>
      <select
        className="workspace-select"
        value={selectedWorkspace ? selectedWorkspace.id : ''}
        onChange={(e) => selectWorkspace(e.target.value)}
        disabled={workspaces.length === 0}
      >
        {workspaces.length === 0 ? (
          <option value="">No workspaces available</option>
        ) : (
          <>
            <option value="">-- Select Workspace --</option>
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.slackTeamName}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}

export default WorkspaceSelector; 
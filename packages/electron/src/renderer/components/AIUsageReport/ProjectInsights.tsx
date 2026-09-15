import React, { useEffect, useState } from 'react';
import { SectionHeading } from './ReportControls';

interface ProjectUsageStats {
  workspaceId: string;
  sessionCount: number;
  totalTokens: number;
  lastActivity: number;
}

export const ProjectInsights: React.FC<{ sinceMs?: number }> = ({ sinceMs }) => {
  const [projects, setProjects] = useState<ProjectUsageStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const data = await window.electronAPI.invoke('usage-analytics:get-usage-by-project', sinceMs);
        setProjects(data);
      } catch (error) {
        console.error('Failed to load project insights:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [sinceMs]);

  if (loading) {
    return <div className="project-insights-loading flex items-center justify-center min-h-[400px] text-nim-muted text-base">Loading...</div>;
  }

  return (
    <div className="project-insights flex flex-col gap-6">
      <SectionHeading>Usage by Project</SectionHeading>

      {projects.length > 0 ? (
        <div className="project-list grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {projects.map((project, index) => (
            <div key={index} className="project-card bg-nim-secondary border border-nim rounded-lg p-5">
              <div className="project-name text-base font-semibold text-nim mb-4">{project.workspaceId.split('/').pop() || project.workspaceId}</div>
              <div className="project-stats flex flex-col gap-2">
                <div className="project-stat flex justify-between text-sm">
                  <span className="project-stat-label text-nim-muted">Sessions:</span>
                  <span className="project-stat-value text-nim font-medium">{project.sessionCount}</span>
                </div>
                <div className="project-stat flex justify-between text-sm">
                  <span className="project-stat-label text-nim-muted">Tokens:</span>
                  <span className="project-stat-value text-nim font-medium">{project.totalTokens.toLocaleString()}</span>
                </div>
                <div className="project-stat flex justify-between text-sm">
                  <span className="project-stat-label text-nim-muted">Last Active:</span>
                  <span className="project-stat-value text-nim font-medium">
                    {new Date(project.lastActivity).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-data flex items-center justify-center min-h-[400px] text-nim-muted text-base">No project data available</div>
      )}
    </div>
  );
};

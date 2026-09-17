/**
 * §29 Projects — context gathered from conversation.
 */
import { fetchProjects, type Project } from "../../lib/api";
import { EmptyState, LoadFailure, PageHeader } from "../surface";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  let projects: readonly Project[];
  try {
    projects = await fetchProjects();
  } catch (error: unknown) {
    return (
      <section className="page">
        <PageHeader title="Projects" />
        <LoadFailure error={error} />
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="Projects"
        subtitle="Context gathered from conversations and people."
        eyebrow="Projects"
      />
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Name a project in conversation and it will appear here."
        />
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <div className="project-card" key={project.id}>
              <div className="project-title">
                <span>{project.name}</span>
              </div>
              <span className="project-glyph">{project.name.slice(0, 1).toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

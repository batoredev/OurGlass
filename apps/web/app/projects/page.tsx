/** §29 Projects, read-only. */
import { fetchProjects, type Project } from "../../lib/api";
import { LoadError, Page, Table, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  let projects: readonly Project[];
  try {
    projects = await fetchProjects();
  } catch (error: unknown) {
    return (
      <Page title="Projects">
        <LoadError error={error} />
      </Page>
    );
  }

  const columns: Column<Project>[] = [
    { key: "name", header: "Name", render: (project) => project.name },
  ];

  return (
    <Page title="Projects">
      <Table columns={columns} rows={projects} rowKey={(project) => project.id} empty="projects" />
    </Page>
  );
}

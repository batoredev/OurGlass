/**
 * §35 Permissions — held actions awaiting approval, and standing rules.
 *
 * PENDING FIRST: a held action is the assistant waiting on you, and it expires.
 * Standing rules change rarely and can wait below it.
 *
 * The one surface with buttons, and deliberately so: these decisions are the
 * ones the model must never make on your behalf (PHASE-7-PERMISSIONS-DESIGN §1).
 */
import { fetchPermissions, type PendingAction, type PermissionGrant, type Permissions } from "../../lib/api";
import { LoadError, Page, Table, formatWhen, type Column } from "../ui";
import { PendingActionButtons, RevokeButton, SetPermissionForm } from "./controls";

export const dynamic = "force-dynamic";

function isOpen(action: PendingAction): boolean {
  return action.status === "pending" && new Date(action.expires_at).getTime() > Date.now();
}

export default async function PermissionsPage() {
  let permissions: Permissions;
  try {
    permissions = await fetchPermissions();
  } catch (error: unknown) {
    return (
      <Page title="Permissions">
        <LoadError error={error} />
      </Page>
    );
  }

  const pendingColumns: Column<PendingAction>[] = [
    { key: "what", header: "Waiting to do", render: (action) => action.summary },
    { key: "risk", header: "Risk", render: (action) => action.risk_level },
    { key: "asked", header: "Asked", render: (action) => formatWhen(action.t_created) },
    {
      key: "state",
      header: "",
      // An expired request says so rather than offering a button that will
      // only be refused: an approval now would approve a moved-on world.
      render: (action) =>
        isOpen(action) ? (
          <PendingActionButtons id={action.id} />
        ) : action.status === "pending" ? (
          "expired"
        ) : (
          action.status
        ),
    },
  ];

  const grantColumns: Column<PermissionGrant>[] = [
    { key: "action", header: "Action", render: (grant) => grant.action_type },
    {
      key: "rule",
      header: "Rule",
      render: (grant) => (grant.decision === "allow" ? "Always allow" : "Always ask first"),
    },
    { key: "since", header: "Since", render: (grant) => formatWhen(grant.t_valid) },
    { key: "revoke", header: "", render: (grant) => <RevokeButton actionType={grant.action_type} /> },
  ];

  return (
    <Page title="Permissions">
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Waiting for your approval</h2>
      <Table
        columns={pendingColumns}
        rows={permissions.pending}
        rowKey={(action) => action.id}
        empty="held actions"
      />

      <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem" }}>Standing rules</h2>
      <p style={{ color: "#666", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
        Without a rule, things inside OurGlass happen immediately and can be undone; actions that
        reach outside it always ask first. A rule can make an action stricter, or always allow an
        outside action — never one marked high impact.
      </p>
      <Table columns={grantColumns} rows={permissions.grants} rowKey={(grant) => grant.id} empty="rules" />
      <div style={{ marginTop: "1rem" }}>
        <SetPermissionForm actionTypes={permissions.actionTypes} />
      </div>
    </Page>
  );
}

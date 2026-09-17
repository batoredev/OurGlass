/**
 * Settings — the §35 control plane, plus the way out.
 *
 * The supplied design showed toggles for Google Calendar, Email and Drive.
 * Those integrations do not exist yet (master plan stage 14), and a switch
 * that controls nothing is worse than no switch: it tells you a permission is
 * enforced when nothing enforces it. What is here instead is the permission
 * system that IS built — standing rules per action, and approvals for held
 * actions — and an honest note about the rest.
 */
import Link from "next/link";
import { fetchPermissions, type PendingAction, type Permissions } from "../../lib/api";
import { PendingActionButtons, RevokeButton, SetPermissionForm } from "../permissions/controls";
import { LoadFailure, PageHeader } from "../surface";
import { SignOutButton } from "./sign-out";

export const dynamic = "force-dynamic";

function isOpen(action: PendingAction): boolean {
  return action.status === "pending" && new Date(action.expires_at).getTime() > Date.now();
}

export default async function SettingsPage() {
  let permissions: Permissions;
  try {
    permissions = await fetchPermissions();
  } catch (error: unknown) {
    return (
      <section className="page page-narrow">
        <PageHeader title="Settings" />
        <LoadFailure error={error} />
      </section>
    );
  }

  return (
    <section className="page page-narrow">
      <PageHeader
        title="Settings"
        subtitle="Control how OurGlass remembers and acts."
        eyebrow="Preferences"
      />

      <section className="section">
        <h2 className="section-title">Waiting for your approval</h2>
        <div className="rule-list">
          {permissions.pending.length === 0 ? (
            <div className="row">
              <div>
                <div className="row-title">Nothing held</div>
                <div className="row-subtitle">Actions that need your say-so will wait here.</div>
              </div>
            </div>
          ) : (
            permissions.pending.map((action) => (
              <div className="row" key={action.id}>
                <div>
                  <div className="row-title">{action.summary}</div>
                  <div className="row-subtitle">
                    {action.risk_level} ·{" "}
                    {isOpen(action)
                      ? "waiting for you"
                      : action.status === "pending"
                        ? "expired"
                        : action.status}
                  </div>
                </div>
                {isOpen(action) ? <PendingActionButtons id={action.id} /> : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Standing rules</h2>
        <p className="page-subtitle" style={{ marginBottom: "12px" }}>
          Without a rule, changes inside OurGlass happen immediately and can be undone; anything
          that would reach outside it always asks first.
        </p>
        <div className="rule-list">
          {permissions.grants.length === 0 ? (
            <div className="row">
              <div>
                <div className="row-title">No rules set</div>
                <div className="row-subtitle">Defaults apply to every action.</div>
              </div>
            </div>
          ) : (
            permissions.grants.map((grant) => (
              <div className="row" key={grant.id}>
                <div>
                  <div className="row-title">{grant.action_type.replace(/_/g, " ")}</div>
                  <div className="row-subtitle">
                    {grant.decision === "allow" ? "Always allow" : "Always ask first"}
                  </div>
                </div>
                <RevokeButton actionType={grant.action_type} />
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: "16px" }}>
          <SetPermissionForm actionTypes={permissions.actionTypes} />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Connected services</h2>
        <div className="rule-list">
          <div className="row">
            <div>
              <div className="row-title">Gmail, Calendar and Drive</div>
              <div className="row-subtitle">
                Not connected yet. When they are, each will appear above as a rule you control, and
                every action that leaves OurGlass will ask before it acts.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Inspect</h2>
        <div className="rule-list">
          <Link className="row" href="/activity">
            <div>
              <div className="row-title">Activity</div>
              <div className="row-subtitle">Every change, and what caused it</div>
            </div>
          </Link>
          <Link className="row" href="/types">
            <div>
              <div className="row-title">Types</div>
              <div className="row-subtitle">Anything you asked OurGlass to start tracking</div>
            </div>
          </Link>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Session</h2>
        <SignOutButton />
      </section>
    </section>
  );
}

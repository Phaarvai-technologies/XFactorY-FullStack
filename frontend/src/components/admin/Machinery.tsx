"use client";

import { Factory, ListTree } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import {
  ActionsMenu,
  DetailsRow,
  DetailsToggle,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  RecordBadge,
  SearchInput,
  Truncate,
} from "@/components/admin/ui";
import { toQuery, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import { fmtDate, machineTone } from "@/lib/admin/format";
import type { MachineList } from "@/lib/admin/types";

const STATUSES = ["Published", "Draft", "Unpublished", "Archived"] as const;

/** Machinery records — company assets, listed with the company that owns them. Read-only. */
export function Machinery() {
  const { go } = useAdminHost();
  const f = useUrlFilters("/admin/machinery");
  const params = { q: f.get("q"), status: f.get("status"), org: f.get("org"), page: f.get("page") || "1", page_size: "25" };
  const { data, error, loading, reload } = useResource<MachineList>(`/machinery${toQuery(params)}`);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Machinery"
        subtitle="Machines and services that manufacturers list. Machinery belongs to a company, not to a user."
      />
      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <SearchInput value={params.q} onCommit={commitSearch} placeholder="Search machine, maker or company" />
          <select
            className="adm-select-sm"
            value={params.status}
            onChange={(e) => f.set({ status: e.target.value })}
            aria-label="Listing status"
          >
            <option value="">All listing statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {params.org && (
          <div className="adm-toolbar-row">
            <span className="adm-filter-chip">
              Company: <b>{data?.company ?? "…"}</b>
              <button type="button" className="btn-text" onClick={() => f.set({ org: null })}>
                Show all companies
              </button>
            </span>
          </div>
        )}
      </div>

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {!data ? (
        loading && <Loading />
      ) : (
        <div className={`card adm-table-card${loading ? " adm-stale" : ""}`}>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-fixed adm-table-wide">
              <colgroup>
                <col className="adm-w-expand" />
                <col className="adm-w-main" />
                <col className="adm-w-company" />
                <col className="adm-w-status" />
                <col className="adm-w-avail" />
                <col className="adm-w-date" />
                <col className="adm-w-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="Details" />
                  <th>Machine</th>
                  <th>Company</th>
                  <th>Listing</th>
                  <th>Availability</th>
                  <th>Added</th>
                  <th className="adm-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="adm-empty-cell">
                      No machinery matches these filters.
                    </td>
                  </tr>
                )}
                {data.rows.map((m) => {
                  const detailsId = `mach-${m.id}`;
                  const isOpen = open === m.id;
                  return (
                    <Fragment key={m.id}>
                      <tr>
                        <td>
                          <DetailsToggle open={isOpen} onToggle={() => setOpen(isOpen ? null : m.id)} controls={detailsId} label={m.name} />
                        </td>
                        <td>
                          <div className="adm-cell-main"><Truncate text={m.name} /></div>
                          <div className="adm-cell-sub"><Truncate text={m.industry} /></div>
                        </td>
                        <td>
                          <button type="button" className="adm-link adm-truncate" title={m.companyName ?? ""} onClick={() => go(`/admin/manufacturers/${m.companyId}`)}>
                            {m.companyName || "Unnamed company"}
                          </button>
                          <RecordBadge type={m.recordType} hideReal />
                        </td>
                        <td>
                          <span className={`badge ${machineTone(m.listingStatus)}`}>{m.listingStatus}</span>
                        </td>
                        <td>
                          <Truncate text={m.availability ?? "Not set"} />
                        </td>
                        <td className="adm-nowrap">{fmtDate(m.createdAt)}</td>
                        <td className="adm-td-actions">
                          <ActionsMenu
                            context={m.name}
                            items={[
                              { label: "Open company", icon: <Factory size={15} />, onSelect: () => go(`/admin/manufacturers/${m.companyId}`) },
                              {
                                label: "Company's listings & responses",
                                icon: <ListTree size={15} />,
                                onSelect: () => go(`/admin/manufacturers/${m.companyId}?tab=capabilities`),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <DetailsRow
                          id={detailsId}
                          colSpan={7}
                          items={[
                            ["Capacity", m.capacity],
                            ["Maker / model", [m.maker, m.model].filter(Boolean).join(" ") || null],
                            ["Year", m.year],
                            ["Photos", String(m.imageCount)],
                            ["Availability", m.availability ?? "Not set by the company"],
                          ]}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => f.set({ page: String(p) }, true)} />
        </div>
      )}
    </>
  );
}

import { redirect } from "next/navigation";

/** The org chart is Organization's People view (B-183); old links keep their person in focus. */
export default async function OrgChartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const focus = (await searchParams).focus;
  const query = new URLSearchParams({ view: "people" });
  if (typeof focus === "string" && focus) query.set("focus", focus);
  redirect(`/organization?${query.toString()}`);
}

import type { LoaderArgs, V2_MetaArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireUserId } from "~/utils/session.server";

import styles from "~/styles/search.css";
import MediaList from "~/components/MediaList";
import { getMediaLabels } from "~/utils/media.server";
import { useState } from "react";
import { useHydrated } from "remix-utils";
import { makeTitle } from "~/utils/meta";

const PAGE_SIZE = 25;

type SelectOptions = "" | "all" | "not-mine";

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export function meta({ location }: V2_MetaArgs<typeof loader>) {
  let title = "Search";
  let selectTitle = "";
  const params = new URLSearchParams(location.search);
  const search = params.get("search");
  const select = params.get("select");

  if (search) {
    title = `Search results for '${search}'`;
  }

  if (select === "not-mine") {
    selectTitle = "not mine";
  }
  if (select === "all") {
    selectTitle = "all";
  }

  return [
    { title: makeTitle([title, selectTitle].filter(Boolean)) },
    {
      name: "description",
      content: "Search for media",
    },
  ];
}

export async function loader({ request }: LoaderArgs) {
  const userId = await requireUserId(request);
  const params = new URLSearchParams(request.url.split("?")[1]);

  const page = parseInt((params.get("page") || "1").trim(), 10);
  const search = (params.get("search") || "").trim();
  const select = (params.get("select") || "").trim();

  const where: Prisma.MediaWhereInput = {};
  if (search) {
    where.labels = { contains: search };
  }
  if (select === "") {
    where.userId = userId;
  }
  if (select === "not-mine") {
    where.userId = { not: userId };
  }

  const [user, mediaCount, media, labels] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { preferredLabels: true },
    }),
    db.media.count({ where }),
    db.media.findMany({
      take: page * PAGE_SIZE,
      where,
      select: {
        id: true,
        url: true,
        thumbnailUrl: true,
        labels: true,
        width: true,
        height: true,
        color: true,
        altText: true,
        user: {
          select: {
            username: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getMediaLabels({
      limit: 100,
      userId:
        select === ""
          ? userId
          : select === "not-mine"
          ? { not: userId }
          : undefined,
    }),
  ]);

  return json({
    user,
    mediaCount,
    media,
    labels,
  });
}

export default function MediaRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams({
    search: "",
    select: "",
  });

  const search = searchParams.get("search") || "";
  const select = searchParams.get("select") as SelectOptions;
  const page = parseInt(searchParams.get("page") || "1", 10);

  return (
    <>
      <header>
        <center>
          <form method="get" action="/">
            <input
              type="search"
              name="search"
              aria-label="Search media"
              placeholder="Search"
              defaultValue={search}
              list="search-labels"
              style={{ marginRight: "0.2em" }}
            />
            <datalist id="search-labels">
              {data.labels.map(([label]) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </datalist>
            <div className="button-group">
              <Link
                role="button"
                className={select === "" ? "active" : ""}
                to={`/?search=${search}`}
              >
                Mine
              </Link>
              <Link
                role="button"
                className={select === "not-mine" ? "active" : ""}
                to={`/?search=${search}&select=not-mine`}
              >
                Not Mine
              </Link>
              <Link
                role="button"
                className={select === "all" ? "active" : ""}
                to={`/?search=${search}&select=all`}
              >
                All
              </Link>
            </div>
            &nbsp;
            <input type="hidden" name="select" value={select} tabIndex={-1} />
            <button type="submit" aira-label="Submit search">
              🔎 Search
            </button>
          </form>
        </center>

        <QuickSearch
          labels={data.labels}
          preferredLabels={data.user?.preferredLabels || ""}
          currentSearch={search}
          currentSelect={select}
        />
        <br />
      </header>

      <MediaList
        media={data.media}
        showUser={select !== ""}
        mediaCount={data.mediaCount}
        pageSize={PAGE_SIZE}
        page={page}
      />
    </>
  );
}

function QuickSearch({
  labels,
  currentSearch,
  preferredLabels = "",
  currentSelect,
}: {
  labels: [string, number][];
  preferredLabels?: string;
  currentSearch: string;
  currentSelect: SelectOptions;
}) {
  const limit = 6;
  const isHydrated = useHydrated();
  const [showAllLabels, setShowAllLabels] = useState(false);

  const preferredLabelsList = preferredLabels
    .split(",")
    .filter(Boolean)
    .map((s) => [s.trim(), 0]);

  const sortedLabels = [...labels].sort((a, b) => b[1] - a[1]);

  const labelsList = showAllLabels
    ? labels
    : preferredLabelsList.concat([...sortedLabels]).slice(0, limit);

  return (
    <center role="group" aria-labelledby="quick-search-header">
      <small>
        {labelsList.length ? (
          <>
            <strong id="quick-search-header">Search for label:</strong>&nbsp;
          </>
        ) : null}
        {labelsList.map(([label, count], i) => (
          <span key={label}>
            {i > 0 && ", "}
            <Link
              className={currentSearch === label ? "active" : ""}
              onClick={() => setShowAllLabels(false)}
              to={`/?search=${label}&select=${currentSelect}`}
            >
              {label}
            </Link>
            {showAllLabels ? <small> ({count})</small> : null}
          </span>
        ))}
        {labels.length > limit && isHydrated && (
          <>
            &nbsp;&nbsp;
            <button
              className="link"
              onClick={() => setShowAllLabels((s) => !s)}
            >
              {showAllLabels ? "show less" : "show more"}
            </button>
          </>
        )}
      </small>
    </center>
  );
}

export function ErrorBoundary() {
  return <div className="notice">I did a whoopsies.</div>;
}

const fs = require("fs");

const API = "https://api.github.com";
const owner = process.env.GITHUB_REPOSITORY_OWNER || "amaralkaff";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const includeForks = String(process.env.INCLUDE_FORKS || "false").toLowerCase() === "true";
const bytesPerHour = Number(process.env.BYTES_PER_HOUR || 40000);
const langCount = Number(process.env.LANG_COUNT || 5);
const readmePath = process.env.README_PATH || "README.md";

if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");

async function github(path) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${await response.text()}`);
  }

  return response.json();
}

async function paginate(path) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const chunk = await github(`${path}${separator}per_page=100&page=${page}`);
    if (!chunk.length) return rows;
    rows.push(...chunk);
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hourText = `${hrs.toLocaleString("en-US")} ${hrs === 1 ? "hr" : "hrs"}`;
  if (!mins) return hourText;
  return `${hourText} ${mins} ${mins === 1 ? "min" : "mins"}`;
}

function progressBar(percent) {
  const width = 25;
  const full = Math.floor((percent / 100) * width);
  const fraction = (percent / 100) * width - full;
  const partials = ["", "⣄", "⣤", "⣦", "⣶", "⣷"];
  const partial = partials[Math.round(fraction * (partials.length - 1))] || "";
  return `${"⣿".repeat(full)}${partial}${"⣀".repeat(width - full - (partial ? 1 : 0))}`;
}

function buildSection(lines) {
  return [
    "<!--START_SECTION:github-->",
    "",
    "```txt",
    ...lines,
    "```",
    "",
    "<!--END_SECTION:github-->",
    "",
  ].join("\n");
}

async function main() {
  const repos = (await paginate("/user/repos?affiliation=owner&visibility=all")).filter((repo) => {
    return repo.owner.login.toLowerCase() === owner.toLowerCase()
      && !repo.archived
      && (includeForks || !repo.fork);
  });

  const totals = new Map();
  let totalBytes = 0;
  let totalStars = 0;
  let firstCreatedAt = null;

  for (const repo of repos) {
    totalStars += repo.stargazers_count || 0;

    let languages = {};
    try {
      languages = await github(`/repos/${owner}/${encodeURIComponent(repo.name)}/languages`);
    } catch {
      languages = {};
    }

    if (Object.keys(languages).length) {
      const createdAt = new Date(repo.created_at);
      if (!firstCreatedAt || createdAt < firstCreatedAt) firstCreatedAt = createdAt;
    }

    for (const [name, bytes] of Object.entries(languages)) {
      totals.set(name, (totals.get(name) || 0) + bytes);
      totalBytes += bytes;
    }
  }

  if (!totalBytes) throw new Error("No GitHub language bytes found");

  const totalMinutes = Math.max(1, Math.round((totalBytes / bytesPerHour) * 60));
  const languages = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, langCount);

  const lines = [
    `From: ${formatDate(firstCreatedAt || new Date())} - To: ${formatDate(new Date())}`,
    "",
    `Total Time: ${formatDuration(totalMinutes)}`,
    "",
    ...languages.map(([name, bytes]) => {
      const percent = (bytes / totalBytes) * 100;
      const minutes = Math.max(1, Math.round((totalMinutes * bytes) / totalBytes));
      return `${name.padEnd(34)} ${formatDuration(minutes).padEnd(19)} ${progressBar(percent)}   ${percent.toFixed(2).padStart(5, "0")} %`;
    }),
    "",
    `Total Stars: ${totalStars} ★`,
  ];

  const readme = fs.readFileSync(readmePath, "utf8");
  const section = buildSection(lines);
  if (!readme.includes("<!--START_SECTION:github-->")) {
    throw new Error("README.md is missing <!--START_SECTION:github-->");
  }

  const next = readme.replace(/<!--START_SECTION:github-->[\s\S]*?<!--END_SECTION:github-->\n?/, section);

  fs.writeFileSync(readmePath, next, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

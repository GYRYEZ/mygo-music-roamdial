// RoamDial for MyGo Music.
// RoamDial publishes its station map as two files: a small index of places and
// genres, and a larger list of names and stream addresses. They line up by
// position, so the plugin joins them once and keeps the result for this run.

const SITE = "https://roamdial.com";
const PAGE_SIZE = 60;
const PAGE_LIMIT = 60;
const FALLBACK_COVERS = 36;

let pending = null;
let cache = null;
const details = new Map();

function isChinese() {
  try {
    return host.language().toLowerCase().indexOf("zh") === 0;
  } catch (_) {
    return false;
  }
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("RoamDial 数据接口返回 " + response.status);
  return response.json();
}

function directStream(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  return !/\.(m3u8|m3u|pls|xspf)(\?|#|$)/i.test(url);
}

function asset(name) {
  return "file://" + encodeURI(host.dir) + "/covers/" + name;
}

function fallbackCover(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const n = hash % FALLBACK_COVERS;
  return asset("station-" + (n < 10 ? "0" : "") + n + ".jpg");
}

function genreCover(index) {
  return asset("genre-" + index + ".jpg");
}

function countryCover(code) {
  const value = String(code || "").toLowerCase();
  if (!/^[a-z]{2}$/.test(value) || value === "zz") return asset("country-zz.jpg");
  return asset("country-" + value + ".jpg");
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// MyGo decodes PNG, JPEG and WebP. A station's own icon may be an ICO, SVG or
// GIF, so those go through an image proxy that hands back a square PNG.
function proxiedImage(url) {
  return (
    "https://images.weserv.nl/?url=" +
    encodeURIComponent(url) +
    "&w=600&h=600&fit=cover&output=png&n=-1"
  );
}

// A station's page has its logo and a line about it. Only pictures MyGo can
// decode are used; the rest fall back to one of the plugin's own covers.
async function stationDetail(station) {
  if (details.has(station.id)) return details.get(station.id);
  let found = { cover: "", about: "" };
  try {
    const data = await withTimeout(
      getJSON(SITE + "/api/stations/" + encodeURIComponent(station.id)),
      3500,
    );
    const favicon = String(data.favicon || "");
    if (/^https?:\/\//i.test(favicon)) {
      found.cover = /\.(png|jpe?g|webp)(\?|#|$)/i.test(favicon)
        ? favicon
        : proxiedImage(favicon);
    }
    found.about = String(data.about || "").trim();
  } catch (_) {}
  details.set(station.id, found);
  return found;
}

async function prefetch(stations) {
  const todo = [];
  const seen = new Set();
  for (const station of stations) {
    if (details.has(station.id) || seen.has(station.id)) continue;
    seen.add(station.id);
    todo.push(station);
  }
  let next = 0;
  const workers = [];
  const count = Math.min(10, todo.length);
  for (let i = 0; i < count; i++) {
    workers.push(
      (async () => {
        while (next < todo.length) {
          await stationDetail(todo[next++]);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

function coverOf(station) {
  const found = details.get(station.id);
  return (found && found.cover) || fallbackCover(station.id);
}

function load() {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = (async () => {
    const [index, list] = await Promise.all([
      getJSON(SITE + "/api/globe?part=core"),
      getJSON(SITE + "/api/globe?part=rest"),
    ]);
    const stations = [];
    const byId = new Map();
    for (let i = 0; i < list.id.length; i++) {
      const url = String(list.url[i] || "");
      if (!directStream(url)) continue;
      const station = {
        id: String(list.id[i]),
        name: String(list.name[i] || "").trim() || "未命名电台",
        url,
        tags: String(list.tags[i] || ""),
        state: String(list.state[i] || ""),
        country: index.c[i],
        genre: index.g[i],
        language: index.l[i],
        popularity: Number(index.pop[i]) || 0,
      };
      station.searchText = [
        station.name,
        station.tags,
        station.state,
        textOf(index.countries, index.c[i]),
        textOf(index.genres, index.g[i]),
        textOf(index.genresEn, index.g[i]),
      ]
        .join(" ")
        .toLowerCase();
      stations.push(station);
      byId.set(station.id, station);
    }
    const countries = index.countries.map((row, i) => ({
      index: i,
      code: row[0],
      name: isChinese() ? row[1] : row[2],
      count: stations.filter((s) => s.country === i).length,
    }));
    const genres = index.genres.map((name, i) => ({
      index: i,
      name: isChinese() ? name : index.genresEn[i] || name,
      count: stations.filter((s) => s.genre === i).length,
    }));
    cache = { stations, byId, countries, genres, index };
    pending = null;
    return cache;
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

function textOf(rows, index) {
  const row = rows && rows[index];
  if (!row) return "";
  return isChinese() ? row[1] || row[0] || "" : row[2] || row[0] || "";
}

function countryName(data, index) {
  return textOf(data.index.countries, index);
}

function genreName(data, index) {
  const row = data.index.genres || [];
  const english = data.index.genresEn || [];
  if (isChinese()) return row[index] || english[index] || "";
  return english[index] || row[index] || "";
}

function trackOf(data, station) {
  const country = countryName(data, station.country);
  const genre = genreName(data, station.genre);
  const found = details.get(station.id) || {};
  const detail = [];
  if (found.about) detail.push(found.about);
  if (station.state) detail.push(station.state);
  if (station.tags) detail.push(station.tags.split(",").slice(0, 6).join(" · "));
  return {
    id: station.id,
    name: station.name,
    artists: country ? [{ id: "country:" + station.country, name: country }] : [],
    album: {
      id: "genre:" + station.genre,
      name: genre || "RoamDial",
      imageUrl: coverOf(station),
    },
    duration: 0,
    url: SITE + "/?s=" + encodeURIComponent(station.name),
    description: detail.join(" · "),
  };
}

function sorted(data, stations) {
  return stations.slice().sort((a, b) => {
    if (b.popularity !== a.popularity) return b.popularity - a.popularity;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

async function topOf(data, stations) {
  const picked = sorted(data, stations).slice(0, PAGE_LIMIT);
  await prefetch(picked);
  return picked.map((s) => trackOf(data, s));
}

function link(title, page, subtitle, imageUrl) {
  const item = { title, page };
  if (subtitle) item.subtitle = subtitle;
  if (imageUrl) item.imageUrl = imageUrl;
  return item;
}

export async function home() {
  const data = await load();
  const popular = sorted(data, data.stations).slice(0, 24);
  await prefetch(popular);
  return {
    title: "RoamDial",
    subtitle: isChinese() ? "世界网络电台" : "Radio from around the world",
    description: isChinese()
      ? data.stations.length + " 个可直接播放的电台 · 数据来自 RoamDial"
      : data.stations.length + " playable stations · data from RoamDial",
    sections: [
      {
        title: isChinese() ? "热门电台" : "Popular stations",
        tracks: popular.map((s) => trackOf(data, s)),
      },
      {
        title: isChinese() ? "按分类" : "By genre",
        links: data.genres
          .filter((g) => g.count > 0)
          .map((g) =>
            link(
              g.name,
              "genre:" + g.index,
              g.count + (isChinese() ? " 个电台" : " stations"),
              genreCover(g.index),
            ),
          ),
        morePage: "genres",
      },
      {
        title: isChinese() ? "按国家" : "By country",
        links: data.countries
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
          .map((c) =>
            link(
              c.name,
              "country:" + c.index,
              c.count + (isChinese() ? " 个电台" : " stations"),
              countryCover(c.code),
            ),
          ),
        morePage: "countries",
      },
      {
        title: isChinese() ? "探索" : "Explore",
        links: [
          link(isChinese() ? "随便听听" : "Surprise me", "random", "", asset("station-00.jpg")),
        ],
      },
    ],
  };
}

export async function browse({ page }) {
  const data = await load();
  const wanted = String(page || "");
  if (wanted === "" || wanted === "home") return home();
  if (wanted === "genres") {
    return {
      title: isChinese() ? "电台分类" : "Genres",
      sections: [
        {
          links: data.genres
            .filter((g) => g.count > 0)
            .map((g) =>
              link(
                g.name,
                "genre:" + g.index,
                g.count + (isChinese() ? " 个电台" : " stations"),
                genreCover(g.index),
              ),
            ),
        },
      ],
    };
  }
  if (wanted === "countries") {
    return {
      title: isChinese() ? "国家与地区" : "Countries and regions",
      sections: [
        {
          links: data.countries
            .filter((c) => c.count > 0)
            .sort((a, b) => b.count - a.count)
            .map((c) =>
              link(
                c.name,
                "country:" + c.index,
                c.count + (isChinese() ? " 个电台" : " stations"),
                countryCover(c.code),
              ),
            ),
        },
      ],
    };
  }
  if (wanted.indexOf("genre:") === 0) {
    const index = Number(wanted.slice(6));
    const found = data.stations.filter((s) => s.genre === index);
    return {
      title: genreName(data, index),
      subtitle: found.length + (isChinese() ? " 个电台" : " stations"),
      sections: [{ tracks: await topOf(data, found) }],
    };
  }
  if (wanted.indexOf("country:") === 0) {
    const index = Number(wanted.slice(8));
    const found = data.stations.filter((s) => s.country === index);
    return {
      title: countryName(data, index),
      subtitle: found.length + (isChinese() ? " 个电台" : " stations"),
      sections: [{ tracks: await topOf(data, found) }],
    };
  }
  if (wanted === "random") {
    const now = new Date();
    let seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const picked = [];
    const used = new Set();
    while (picked.length < PAGE_LIMIT && used.size < data.stations.length) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const i = seed % data.stations.length;
      if (used.has(i)) continue;
      used.add(i);
      picked.push(data.stations[i]);
    }
    await prefetch(picked);
    return {
      title: isChinese() ? "随便听听" : "Surprise me",
      subtitle: isChinese() ? "今天从世界各地抽到的电台" : "Stations picked for today",
      sections: [{ tracks: picked.map((s) => trackOf(data, s)) }],
    };
  }
  throw fail("unavailable", isChinese() ? "没有这个页面" : "no such page");
}

export async function search({ query, kind, offset }) {
  if (kind !== "tracks") return {};
  const data = await load();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { tracks: [], more: false };
  const words = q.split(/\s+/).filter(Boolean);
  const found = [];
  for (const station of data.stations) {
    let hit = true;
    for (const word of words) {
      if (station.searchText.indexOf(word) < 0) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    let rank = 1;
    if (station.name.toLowerCase().indexOf(q) === 0) rank = 3;
    else if (station.name.toLowerCase().indexOf(q) >= 0) rank = 2;
    found.push({ station, rank });
  }
  found.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.station.popularity !== a.station.popularity) return b.station.popularity - a.station.popularity;
    return a.station.name < b.station.name ? -1 : 1;
  });
  const start = Math.max(0, Number(offset) || 0);
  const page = found.slice(start, start + PAGE_SIZE);
  await prefetch(page.map((row) => row.station));
  return {
    tracks: page.map((row) => trackOf(data, row.station)),
    more: start + PAGE_SIZE < found.length,
  };
}

export async function suggest({ query }) {
  const data = await load();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const station of data.stations) {
    if (out.length >= 8) break;
    if (station.name.toLowerCase().indexOf(q) >= 0) out.push(station.name);
  }
  return out;
}

export async function stream({ id, quality }) {
  const data = await load();
  const station = data.byId.get(String(id));
  if (!station) throw fail("unavailable", isChinese() ? "这个电台不在了" : "this station is gone");
  return {
    url: station.url,
    type: streamType(station.url),
    quality,
  };
}

function streamType(url) {
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  if (path.endsWith(".aac")) return "aac";
  if (path.endsWith(".m4a")) return "m4a";
  if (path.endsWith(".ogg") || path.endsWith(".opus")) return "ogg";
  if (path.endsWith(".flac")) return "flac";
  if (path.endsWith(".wav")) return "wav";
  return "mp3";
}

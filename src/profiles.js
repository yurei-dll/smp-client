export const catalogBaseUrl =
  "https://raw.githubusercontent.com/yurei-dll/smp/main/pack/catalog";

export const packProfiles = Object.freeze({
  client: Object.freeze({
    name: "Standard pack",
    groups: Object.freeze(["core", "client"]),
  }),
  core: Object.freeze({
    name: "Barebones pack",
    groups: Object.freeze(["core"]),
  }),
});

export function profileFor(value) {
  return packProfiles[value] ?? packProfiles.client;
}

export function catalogUrlsFor(value) {
  return profileFor(value).groups.map((group) => `${catalogBaseUrl}/${group}.json`);
}

const searchCatalog = { data: null, promise: null };
let topicPicker = null;
function syncTopicPicker() {
  const select = document.querySelector("#category-filter");
  if (topicPicker && select && topicPicker.getValue() !== select.value)
    topicPicker.setValue(select.value, true);
}
async function loadSearch() {
  if (searchCatalog.data) return searchCatalog.data;
  if (searchCatalog.promise) return searchCatalog.promise;
  searchCatalog.promise = Promise.all(
    ["/data/catalog.json", "/data/bosses.json"].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw Error("Search could not load");
      return response.json();
    }),
  )
    .then(async ([guides, bosses]) => {
      const index = createSearchIndex(
        [...bosses.map(bossDocument), ...guides.map(guideDocument)],
        { defer: true },
      );
      await index.ready;
      return (searchCatalog.data = { guides, bosses, index });
    })
    .catch((error) => {
      searchCatalog.promise = null;
      throw error;
    });
  return searchCatalog.promise;
}

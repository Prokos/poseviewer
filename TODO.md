
Refresh sample on create set card should refresh the images not the index

create page cards should be stacked not columns

remove search bar from set overview page, improve design of clear filters button and sorting dropdown

Our header element could be full width of the page and the navigation underline should bleed to page edges.
improve design of connection status, just show one icon that either shows disconnected or connected, and pressing will always connect or reconnect. no status and button seperately etc

On create set page the directory component should have the same style as that from the set viewer page

Add a hide button next to favorite in the modal. Pressing it removes the image from favorites if it was one, and it hides it everywhere. It can only be found in the set viewer under a hidden tab (which functions the same as the other tabs, just shows hidden images). On desktop you can press H as a shortcut, it has similar animations to the one for favoriting and unfavoriting.

If all images are loaded on a tab  we dont need to show the load more or load all buttons anymore.

Persist choice of sorting on set overview page in localstorage

Context button shouldnt show up in modal  from samples when creating a set (the button doesnt work either, so shouldnt we be able to just auto detect when we can show the button?)

Panning back to 100% doesnt snap the image back to non-zoomed state

clicking on a set should start at top of the page

ability to permanently rotate images, and all images in a set at the same time

favoriting gesture and button should be disabled in places where we cant favorite (e.g. sample modal from create a set)

auto starting a slideshow should also enter fullscreen when opening modal

smart random sorting for slideshows that prioritises not repeating sets at least not twice in a row - we dont hae to cycle through sets before we return to one, but reduced chance for chronological items in a set and the same set after one another would be good for overall slideshow quality

there is abug with context, i went from sample or favorite to context, then a few images its correct but after some it breaks context and then im just lost somewhere random in the set, still chronologcail but not around the original image anymore? im not sure how it happens

REFACTOR

  Context / Goals

  - You want real simplification, not just moving code.
  - The grid tabs (sample/favorites/nonfavorites/all) share the same logic; only data +
    filtering differ, so you want ONE grid controller and ONE set of state/handlers.
  - You don’t want huge prop lists or provider objects that just shuttle state around.
  - You want fewer files and fewer helpers; only keep shared helpers that genuinely
    reduce complexity.
  - You want the tabs config to be the source of truth, and to include filter/sort logic
    directly (no helper indirection).

  Problems in current state

  - Still multiple grid handlers/state in App and large “value objects”.
  - Context/provider pattern used where it’s unnecessary.
  - Extra helpers (e.g., useLoadMoreClick) for trivial logic.
  - Codebase is growing instead of shrinking.

  Plan (to implement later)

  1. Collapse state into pages
      - Move set‑viewer grid logic into src/pages/SetViewerPage.tsx.
      - Move slideshow grid logic into src/pages/SlideshowPage.tsx.
      - Remove SetViewerContext/SlideshowContext providers from src/App.tsx.
  2. Single grid controller hook
      - Create useGridController(config) that returns:
          - images, isLoading, loadMore, loadAll, reset, gridRef, pageSize
      - It accepts:
          - resolveImages(setId or filter), filter, sort, loadLabel, pageSize.
  3. Tabs are the source of truth
      - In SetViewerPage, define:

        const tabs = {
          samples: {
            label: 'Sample',
            filter: (images, favorites) => images,
            sort: (images) => shuffle(images),
            loadLabel: 'Loading sample…',
          },
          favorites: {
            label: 'Favorites',
            filter: (images, favorites) => images.filter(...),
            sort: (images) => shuffle(images),
            loadLabel: 'Loading favorites…',
          },
          nonfavorites: {
            label: 'Non favorites',
            filter: (images, favorites) => images.filter(...),
            sort: (images) => shuffle(images),
            loadLabel: 'Loading images…',
          },
          all: {
            label: 'All',
            filter: (images) => images,
            sort: (images) => images,
            loadLabel: 'Loading images…',
          },
        };
      - No helper layer: filter/sort logic lives directly in this tabs object.
  4. Remove duplicated handlers
      - Delete handleLoadMoreSample/Favorites/NonFavorites, handleLoadAllX.
      - Use the single grid controller loadMore/loadAll.
      - Inline trivial click logic; delete useLoadMoreClick.
  5. Delete unused files
      - Remove src/features/setViewer/*.
      - Remove src/features/slideshow/*.
      - Remove any one‑off helpers that don’t reduce code.
  6. Verify parity
      - Loading labels remain correct.
      - Favorites/thumbnail actions still work.
      - Slideshow still loads/picks images the same way.



Wyimaginowany

vogue runway archive

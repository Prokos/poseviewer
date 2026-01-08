Start set overview in random order (add random order to top of sorting options)
Refresh sample on create set card should refresh the images not the index
create page cards should be stacked not columns
remove search bar from set overview page, improve design of clear filters button and sorting dropdown
improve design of connection status, just show one icon that either shows disconnected or connected, and pressing will always connect or reconnect. no status and button seperately etc
On create set page the directory component should have the same style as that from the set viewer page
When opening the set viewer page the images start loading but then seem to unload before starting again, some control flow bug?
Pressing esc on desktop in the modal should not first quit fullscreen and then the modal, but both at the same time with a single press

Set viewer should have three tabs: All Images, Favorites, Non-Favorites
By default the tabs are randomly sorted, but there's a toggle to make them chronological. Switching the toggle reloads the first page of images based on the new toggle state.

If all images are loaded on a tab  we dont need to show the load more or load all buttons anymore.

Speed up loading indexes in the slideshow page (maybe it can be parralized or smt?) - when doing favorites only for example we hit all sets (250+) and its slow as hell

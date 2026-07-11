import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace guest user block
old_guest_block = """        const lastActiveId = localStorage.getItem(`pcp-lastActive-guest-user`);
        const projectToLoad = migrateProject(localProjects[lastActiveId!] || Object.values(localProjects)[0]);
        if (projectToLoad) {
            setLastSavedTime(projectToLoad.lastModified);
            setActiveProject(projectToLoad);
            dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
            dispatchSummary({ type: 'LOAD_DATA', payload: projectToLoad.summaryData || projectToLoad.liveData });
        }"""

new_guest_block = """        const lastActiveId = localStorage.getItem(`pcp-lastActive-guest-user`);
        const projectToLoad = migrateProject(localProjects[lastActiveId!] || Object.values(localProjects)[0]);
        if (projectToLoad) {
            setLastSavedTime(projectToLoad.lastModified);
            setActiveProject(projectToLoad);
            if (projectToLoad.startDate) {
                setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
            }
            dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
            dispatchSummary({ type: 'LOAD_DATA', payload: projectToLoad.summaryData || projectToLoad.liveData });

            if (projectToLoad.displaySettings) {
                if (projectToLoad.displaySettings.visibleColumns) {
                    setVisibleColumns(projectToLoad.displaySettings.visibleColumns);
                }
                if (projectToLoad.displaySettings.activeFilters) {
                    const restoredFilters = {};
                    Object.entries(projectToLoad.displaySettings.activeFilters).forEach(([key, arr]) => {
                        restoredFilters[key] = new Set(arr);
                    });
                    setActiveFilters(restoredFilters);
                }
            }
        }"""

# Replace guest block for both LF and CRLF line endings
content = content.replace(old_guest_block.replace('\n', '\n'), new_guest_block)
content = content.replace(old_guest_block.replace('\n', '\r\n'), new_guest_block.replace('\n', '\r\n'))

# 2. Replace onSnapshot user block
old_snap_block = """         if (needsInitialLoad && !activeProjectRef.current) {
             const lastActiveId = localStorage.getItem(`pcp-lastActive-${currentUser.uid}`);
             const projectToLoad = newProjects[lastActiveId!];
             if (projectToLoad) {
                 setLastSavedTime(projectToLoad.lastModified);
                 setActiveProject(projectToLoad);
             if (projectToLoad.startDate) {
                 setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
             }
                 dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
             } else if (Object.keys(newProjects).length > 0) {
                  setLoadModalOpen(true);
             }
         }"""

new_snap_block = """         if (needsInitialLoad && !activeProjectRef.current) {
             const lastActiveId = localStorage.getItem(`pcp-lastActive-${currentUser.uid}`);
             const projectToLoad = newProjects[lastActiveId!];
             if (projectToLoad) {
                 setLastSavedTime(projectToLoad.lastModified);
                 setActiveProject(projectToLoad);
                 if (projectToLoad.startDate) {
                     setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
                 }
                 dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
                 dispatchSummary({ type: 'LOAD_DATA', payload: projectToLoad.summaryData || projectToLoad.liveData });

                 if (projectToLoad.displaySettings) {
                     if (projectToLoad.displaySettings.visibleColumns) {
                         setVisibleColumns(projectToLoad.displaySettings.visibleColumns);
                     }
                     if (projectToLoad.displaySettings.activeFilters) {
                         const restoredFilters = {};
                         Object.entries(projectToLoad.displaySettings.activeFilters).forEach(([key, arr]) => {
                             restoredFilters[key] = new Set(arr);
                         });
                         setActiveFilters(restoredFilters);
                     }
                 }
             } else if (Object.keys(newProjects).length > 0) {
                  setLoadModalOpen(true);
             }
         }"""

# Replace onSnapshot block for both LF and CRLF line endings
content = content.replace(old_snap_block.replace('\n', '\n'), new_snap_block)
content = content.replace(old_snap_block.replace('\n', '\r\n'), new_snap_block.replace('\n', '\r\n'))

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS")

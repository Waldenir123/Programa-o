import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ScheduleData, Status, STATUS_CYCLE, RenderableRow } from '../state/types';
import { deepClone, formatDate } from '../utils/dataUtils';
import { ScheduleAction } from '../state/scheduleReducer';

type CellIdentifier = { activityId: string; date: string };
type SelectionBlock = { anchor: CellIdentifier, end: CellIdentifier };
type ClipboardData = { statuses: (Status | null)[][], sourceBlock: SelectionBlock };

export const useScheduleInteraction = (
    liveData: ScheduleData,
    dispatch: React.Dispatch<ScheduleAction>,
    renderableRows: RenderableRow[],
    dates: Date[],
    addToast: (message: string, type: 'success' | 'error') => void
) => {
    const [isSelecting, setIsSelecting] = useState(false);
    const [isMovingBlock, setIsMovingBlock] = useState(false);
    const [dragStartCell, setDragStartCell] = useState<CellIdentifier | null>(null);
    const [ghostBlockCells, setGhostBlockCells] = useState<Set<string>>(new Set());
    
    const [activeCell, setActiveCell] = useState<CellIdentifier | null>(null);
    const [selectionBlock, setSelectionBlock] = useState<SelectionBlock | null>(null);
    const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
    const [cutSelectionBlock, setCutSelectionBlock] = useState<SelectionBlock | null>(null);

    const stateRef = React.useRef({ isSelecting, isMovingBlock, dragStartCell, selectionBlock, ghostBlockCells });
    React.useEffect(() => {
        stateRef.current = { isSelecting, isMovingBlock, dragStartCell, selectionBlock, ghostBlockCells };
    }, [isSelecting, isMovingBlock, dragStartCell, selectionBlock, ghostBlockCells]);
    
    const activityIdToRowIndex = useMemo(() => new Map(
        (renderableRows || [])
            .filter(r => r.activity)
            .map((r, i) => [r.activity!.id, renderableRows.indexOf(r)])
    ), [renderableRows]);
    const dateToColIndex = useMemo(() => new Map((dates || []).map((d, i) => [formatDate(d), i])), [dates]);

    const getBlockIndices = useCallback((block: SelectionBlock) => {
        const anchorRow = activityIdToRowIndex.get(block.anchor.activityId);
        const anchorCol = dateToColIndex.get(block.anchor.date);
        const endRow = activityIdToRowIndex.get(block.end.activityId);
        const endCol = dateToColIndex.get(block.end.date);
        if (anchorRow === undefined || anchorCol === undefined || endRow === undefined || endCol === undefined) return null;
        
        return {
            minRow: Math.min(anchorRow, endRow), maxRow: Math.max(anchorRow, endRow),
            minCol: Math.min(anchorCol, endCol), maxCol: Math.max(anchorCol, endCol)
        };
    }, [activityIdToRowIndex, dateToColIndex]);

    const isCellInBlock = useCallback((activityId: string, dateStr: string, block: SelectionBlock) => {
        const indices = getBlockIndices(block);
        if (!indices) return false;
        
        const currentRow = activityIdToRowIndex.get(activityId);
        const currentCol = dateToColIndex.get(dateStr);
        if (currentRow === undefined || currentCol === undefined) return false;

        return currentRow >= indices.minRow && currentRow <= indices.maxRow && currentCol >= indices.minCol && currentCol <= indices.maxCol;
    }, [getBlockIndices, activityIdToRowIndex, dateToColIndex]);

    const handleCellMouseDown = useCallback((event: React.MouseEvent, activityId: string, dateStr: string) => {
        if (event.button !== 0 || activityId.startsWith('empty-')) return;
        const currentRef = stateRef.current;

        // Check if clicking inside an existing selection to start a move
        if (currentRef.selectionBlock && isCellInBlock(activityId, dateStr, currentRef.selectionBlock)) {
            setIsMovingBlock(true);
            setDragStartCell({ activityId, date: dateStr });
            document.body.classList.add('dragging');
            return;
        }

        // Default behavior: start a new selection
        setIsSelecting(true);
        document.body.classList.add('dragging');

        const newActiveCell = { activityId, date: dateStr };
        setActiveCell(newActiveCell);
        
        if(!event.shiftKey) {
            setSelectionBlock({ anchor: newActiveCell, end: newActiveCell });
        } else if (currentRef.selectionBlock) {
             setSelectionBlock(prev => prev ? { ...prev, end: newActiveCell } : { anchor: newActiveCell, end: newActiveCell });
        }
    }, [isCellInBlock]);
    
    const handleCellRightClick = useCallback((event: React.MouseEvent, activityId: string, dateStr: string) => {
        event.preventDefault();
        const activity = liveData.flatMap(g => g.tarefas.flatMap(t => t.activities)).find(a => a.id === activityId);
        if (activity) {
            const currentStatus = activity.schedule[dateStr];
            const currentIndex = currentStatus ? STATUS_CYCLE.indexOf(currentStatus) : -1;
            const nextStatus = (currentIndex === STATUS_CYCLE.length - 1) ? null : STATUS_CYCLE[currentIndex + 1];
            dispatch({ type: 'UPDATE_STATUS', payload: { activityId, date: dateStr, status: nextStatus } });
        }
    }, [liveData, dispatch]);

    const handleCellMouseEnter = useCallback((activityId: string, dateStr: string) => {
        const currentRef = stateRef.current;
        if (currentRef.isSelecting) {
            setSelectionBlock(prev => {
                if (!prev || (prev.end.activityId === activityId && prev.end.date === dateStr)) return prev;
                return { ...prev, end: { activityId, date: dateStr } };
            });
        } else if (currentRef.isMovingBlock && currentRef.dragStartCell && currentRef.selectionBlock) {
            const startRow = activityIdToRowIndex.get(currentRef.dragStartCell.activityId);
            const startCol = dateToColIndex.get(currentRef.dragStartCell.date);
            const currentRow = activityIdToRowIndex.get(activityId);
            const currentCol = dateToColIndex.get(dateStr);

            if (startRow === undefined || startCol === undefined || currentRow === undefined || currentCol === undefined) return;

            const rowDelta = currentRow - startRow;
            const colDelta = currentCol - startCol;

            // Only update if delta changed
            setGhostBlockCells(prev => {
                const blockIndices = getBlockIndices(currentRef.selectionBlock!);
                if (!blockIndices) return prev;


                const newGhostCells = new Set<string>();
                for (let r = blockIndices.minRow; r <= blockIndices.maxRow; r++) {
                    for (let c = blockIndices.minCol; c <= blockIndices.maxCol; c++) {
                        const targetRow = r + rowDelta;
                        const targetCol = c + colDelta;
                        if (targetRow >= 0 && targetRow < renderableRows.length && targetCol >= 0 && targetCol < dates.length) {
                            const targetActivity = renderableRows[targetRow].activity;
                            if (targetActivity) {
                                const ghostActivityId = targetActivity.id;
                                const ghostDateStr = formatDate(dates[targetCol]);
                                newGhostCells.add(`${ghostActivityId}-${ghostDateStr}`);
                            }
                        }
                    }
                }
                
                // Very basic check: are sizes same? If so, maybe they are same (not always true but helps)
                // Better check would be to see if delta changed.
                return newGhostCells;
            });
        }
    }, [getBlockIndices, activityIdToRowIndex, dateToColIndex, renderableRows, dates]);

    const handleGlobalMouseUp = useCallback(() => {
        const currentRef = stateRef.current;
        if (currentRef.isSelecting) {
            setIsSelecting(false);
            document.body.classList.remove('dragging');
        }
        if (currentRef.isMovingBlock && currentRef.dragStartCell && currentRef.selectionBlock && currentRef.ghostBlockCells.size > 0) {
            const newData = deepClone(liveData);
            const activityMap = new Map((newData || []).flatMap(g => (g.tarefas || []).flatMap(t => t.activities || [])).map(a => [a.id, a]));
            
            const blockIndices = getBlockIndices(currentRef.selectionBlock);
            if (!blockIndices) return;

            const statusesToMove: (Status | null)[][] = [];
            for (let r = blockIndices.minRow; r <= blockIndices.maxRow; r++) {
                const row: (Status | null)[] = [];
                const sourceActivityId = renderableRows[r].activity?.id;
                const sourceActivity = sourceActivityId ? activityMap.get(sourceActivityId) : undefined;
                for (let c = blockIndices.minCol; c <= blockIndices.maxCol; c++) {
                    const sourceDateStr = formatDate(dates[c]);
                    if (sourceActivity) {
                        row.push(sourceActivity.schedule[sourceDateStr] || null);
                        delete sourceActivity.schedule[sourceDateStr];
                    } else {
                        row.push(null);
                    }
                }
                statusesToMove.push(row);
            }
            
            let minGhostRow = Infinity, minGhostCol = Infinity;
            currentRef.ghostBlockCells.forEach(cellId => {
                const [actId, dateStr] = cellId.split(/(?<=id_\d+_\w+)-/);
                const r = activityIdToRowIndex.get(actId);
                const c = dateToColIndex.get(dateStr);
                if (r !== undefined && r < minGhostRow) minGhostRow = r;
                if (c !== undefined && c < minGhostCol) minGhostCol = c;
            });
            
            statusesToMove.forEach((row, rIdx) => {
                const targetRow = minGhostRow + rIdx;
                if (targetRow < renderableRows.length) {
                    const targetActivityId = renderableRows[targetRow].activity?.id;
                    const targetActivity = targetActivityId ? activityMap.get(targetActivityId) : undefined;
                    if (targetActivity) {
                        row.forEach((status, cIdx) => {
                            const targetCol = minGhostCol + cIdx;
                            if (targetCol < dates.length) {
                                const targetDateStr = formatDate(dates[targetCol]);
                                if (status) targetActivity.schedule[targetDateStr] = status;
                                else delete targetActivity.schedule[targetDateStr];
                            }
                        });
                    }
                }
            });
            
            dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });

            const rowDelta = minGhostRow - blockIndices.minRow;
            const colDelta = minGhostCol - blockIndices.minCol;
            const updateCell = (cell: CellIdentifier) => {
                const r = activityIdToRowIndex.get(cell.activityId)! + rowDelta;
                const c = dateToColIndex.get(cell.date)! + colDelta;
                const targetActivityId = renderableRows[r].activity?.id || `empty-${r}`;
                return { activityId: targetActivityId, date: formatDate(dates[c]) };
            };
            const newSelectionBlock = { anchor: updateCell(currentRef.selectionBlock.anchor), end: updateCell(currentRef.selectionBlock.end) };
            setSelectionBlock(newSelectionBlock);
            setActiveCell(newSelectionBlock.end);
        }
        
        if (currentRef.isMovingBlock) {
            setIsMovingBlock(false);
        }
        if (currentRef.dragStartCell !== null) {
            setDragStartCell(null);
        }
        if (currentRef.ghostBlockCells.size > 0) {
            setGhostBlockCells(new Set());
        }
        document.body.classList.remove('dragging');
    }, [liveData, dispatch, getBlockIndices, activityIdToRowIndex, dateToColIndex, renderableRows, dates]);

    useEffect(() => {
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [handleGlobalMouseUp]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest?.('[contenteditable="true"]') || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        
        if (event.ctrlKey || event.metaKey) {
            switch (event.key.toLowerCase()) {
                case 'c':
                    event.preventDefault();
                    if (!selectionBlock) return;
                    const indicesC = getBlockIndices(selectionBlock);
                    if (!indicesC) return;

                    const copiedStatuses: (Status | null)[][] = [];
                    for (let r = indicesC.minRow; r <= indicesC.maxRow; r++) {
                        const row: (Status | null)[] = [];
                        const activity = renderableRows[r]?.activity;
                        if (activity) {
                            for (let c = indicesC.minCol; c <= indicesC.maxCol; c++) {
                                const date = dates[c];
                                const dateStr = formatDate(date);
                                row.push(activity.schedule[dateStr] || null);
                            }
                        }
                        copiedStatuses.push(row);
                    }
                    setClipboard({ statuses: copiedStatuses, sourceBlock: selectionBlock });
                    setCutSelectionBlock(null);
                    
                    const textToCopy = copiedStatuses.map(row => row.map(s => s || '').join('\t')).join('\n');
                    navigator.clipboard.writeText(textToCopy).catch(console.error);
                    
                    return;
                case 'x':
                    event.preventDefault();
                    if (!selectionBlock) return;
                    const indicesX = getBlockIndices(selectionBlock);
                    if (!indicesX) return;

                    const cutStatuses: (Status | null)[][] = [];
                    for (let r = indicesX.minRow; r <= indicesX.maxRow; r++) {
                        const row: (Status | null)[] = [];
                        const activity = renderableRows[r]?.activity;
                        if (activity) {
                            for (let c = indicesX.minCol; c <= indicesX.maxCol; c++) {
                                const date = dates[c];
                                const dateStr = formatDate(date);
                                row.push(activity.schedule[dateStr] || null);
                            }
                        }
                        cutStatuses.push(row);
                    }
                    setClipboard({ statuses: cutStatuses, sourceBlock: selectionBlock });
                    setCutSelectionBlock(selectionBlock);
                    
                    const textToCut = cutStatuses.map(row => row.map(s => s || '').join('\t')).join('\n');
                    navigator.clipboard.writeText(textToCut).catch(console.error);
                    
                    return;
            }
        }
        
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            if (!selectionBlock && !activeCell) return;

            const updates: { activityId: string; date: string; status: Status | null }[] = [];

            if (selectionBlock) {
                const indices = getBlockIndices(selectionBlock);
                if (indices) {
                    for (let r = indices.minRow; r <= indices.maxRow; r++) {
                        const activityId = renderableRows[r]?.activity?.id;
                        if (activityId) {
                            for (let c = indices.minCol; c <= indices.maxCol; c++) {
                                updates.push({ activityId, date: formatDate(dates[c]), status: null });
                            }
                        }
                    }
                }
            } else if (activeCell) {
                updates.push({ activityId: activeCell.activityId, date: activeCell.date, status: null });
            }

            if (updates.length > 0) {
                dispatch({ type: 'BATCH_UPDATE_STATUS', payload: updates });
            }
            return;
        }
        
        // Handle letter keys for status
        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
            const keyLower = event.key.toLowerCase();
            let matchedStatus: Status | null = null;
            if (keyLower === 'c') matchedStatus = Status.Cancelado;
            else if (keyLower === 'x' || keyLower === 'p') matchedStatus = Status.Programado;
            else if (keyLower === 'n') matchedStatus = Status.NaoRealizado;
            else if (keyLower === 'o' || keyLower === 'k' || keyLower === 'r') matchedStatus = Status.Realizado;
            
            if (matchedStatus) {
                event.preventDefault();
                const updates: { activityId: string; date: string; status: Status | null }[] = [];
                if (selectionBlock) {
                    const indices = getBlockIndices(selectionBlock);
                    if (indices) {
                        for (let r = indices.minRow; r <= indices.maxRow; r++) {
                            const activityId = renderableRows[r]?.activity?.id;
                            if (activityId) {
                                for (let c = indices.minCol; c <= indices.maxCol; c++) {
                                    updates.push({ activityId, date: formatDate(dates[c]), status: matchedStatus });
                                }
                            }
                        }
                    }
                } else if (activeCell) {
                    updates.push({ activityId: activeCell.activityId, date: activeCell.date, status: matchedStatus });
                }

                if (updates.length > 0) {
                    dispatch({ type: 'BATCH_UPDATE_STATUS', payload: updates });
                }
                return;
            }
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            if (!activeCell || renderableRows.length === 0 || dates.length === 0) return;
            
            let currentRow = activityIdToRowIndex.get(activeCell.activityId);
            let currentCol = dateToColIndex.get(activeCell.date);
            
            if (currentRow === undefined || currentCol === undefined) return;
            
            switch(event.key) {
                case 'ArrowUp': currentRow = Math.max(0, currentRow - 1); break;
                case 'ArrowDown': currentRow = Math.min(renderableRows.length - 1, currentRow + 1); break;
                case 'ArrowLeft': currentCol = Math.max(0, currentCol - 1); break;
                case 'ArrowRight': currentCol = Math.min(dates.length - 1, currentCol + 1); break;
            }
            
            const nextActivity = renderableRows[currentRow]?.activity;
            const nextDate = dates[currentCol];
            
            if(nextActivity && nextDate) {
                const nextCell = { activityId: nextActivity.id, date: formatDate(nextDate) };
                setActiveCell(nextCell);
                
                if (event.shiftKey) {
                    setSelectionBlock(prev => prev ? { ...prev, end: nextCell } : { anchor: nextCell, end: nextCell });
                } else {
                    setSelectionBlock({ anchor: nextCell, end: nextCell });
                    setCutSelectionBlock(null);
                }
                
                requestAnimationFrame(() => {
                    const nextCellElement = document.querySelector(`[data-cell-id="${nextCell.activityId}-${nextCell.date}"]`);
                    nextCellElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                });
            }
        }
    }, [activeCell, liveData, dispatch, renderableRows, dates, selectionBlock, clipboard, cutSelectionBlock, addToast, getBlockIndices, activityIdToRowIndex, dateToColIndex]);
    
    const handlePaste = useCallback((event: ClipboardEvent) => {
        const pastedText = event.clipboardData?.getData('text/plain');
        if (!pastedText) return;

        const isTSV = pastedText.includes('\t') || pastedText.includes('\n');
        const activeElement = document.activeElement as HTMLElement;

        // Scenario 1: Focus is on Grid cell (activeCell set, focus is not inside an editable block)
        if (activeCell && !activeElement?.isContentEditable && !['INPUT', 'TEXTAREA'].includes(activeElement?.tagName || '')) {
            event.preventDefault();
            const startRow = activityIdToRowIndex.get(activeCell.activityId);
            const startCol = dateToColIndex.get(activeCell.date);
            if (startRow === undefined || startCol === undefined) return;

            const rowsText = pastedText.split(/\r?\n/).filter(r => r.length > 0);
            const newData = deepClone(liveData);
            const activityMap = new Map((newData || []).flatMap((g: any) => (g.tarefas || []).flatMap((t: any) => t.activities || [])).map((a: any) => [a.id, a]));

            rowsText.forEach((rowStr, rIdx) => {
                const targetRowIndex = startRow + rIdx;
                if (targetRowIndex < renderableRows.length) {
                    const targetActivityId = renderableRows[targetRowIndex].activity?.id;
                    if (!targetActivityId) return;
                    const activityToUpdate = activityMap.get(targetActivityId);
                    if (activityToUpdate) {
                        const colsText = rowStr.split('\t');
                        colsText.forEach((colStr, cIdx) => {
                            const targetColIndex = startCol + cIdx;
                            if (targetColIndex < dates.length) {
                                const targetDateStr = formatDate(dates[targetColIndex]);
                                const statusValue = colStr.trim() || null;
                                
                                // Map pasted values to actual Status enum values or clear if empty/"null"
                                let finalStatus: Status | null = null;
                                const lowerStr = statusValue ? statusValue.toLowerCase() : '';
                                if (lowerStr === 'ok') finalStatus = Status.Realizado;
                                else if (lowerStr === 'x') finalStatus = Status.Programado;
                                else if (lowerStr === 'x2') finalStatus = 'X2' as any; // Allow X2 as a fallback string even if not in enum yet
                                else if (lowerStr === 'n') finalStatus = Status.NaoRealizado;
                                else if (lowerStr === 'c') finalStatus = Status.Cancelado;
                                else if (statusValue && statusValue !== 'null') { // Fallback if they copy exactly innerText "OK" or something
                                   if (Object.values(Status).includes(statusValue as Status)) finalStatus = statusValue as Status;
                                   else finalStatus = Status.Programado; // if copying some random text from excel, maybe assume X?
                                }

                                if (finalStatus) {
                                    activityToUpdate.schedule[targetDateStr] = finalStatus;
                                } else {
                                    delete activityToUpdate.schedule[targetDateStr];
                                }
                            }
                        });
                    }
                }
            });

            if (cutSelectionBlock) {
                const cutIndices = getBlockIndices(cutSelectionBlock);
                if (cutIndices) {
                    for (let r = cutIndices.minRow; r <= cutIndices.maxRow; r++) {
                        const activityToClearId = renderableRows[r].activity?.id;
                        const activityToUpdate = activityToClearId ? activityMap.get(activityToClearId) : undefined;
                        if (activityToUpdate) {
                            for (let c = cutIndices.minCol; c <= cutIndices.maxCol; c++) {
                                const dateToClearStr = formatDate(dates[c]);
                                delete activityToUpdate.schedule[dateToClearStr];
                            }
                        }
                    }
                }
                setCutSelectionBlock(null);
                setClipboard(null);
            }

            dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });
            return;
        }

        // Scenario 2: Focus is on an editable cell (like Atividade name), but they pasted multiple lines
        if (activeElement?.isContentEditable && isTSV) {
            const activityId = activeElement.getAttribute('data-activity-id');
            const columnType = activeElement.getAttribute('data-column-type');
            
            if (activityId && columnType === 'atividade') {
                event.preventDefault();
                const startRow = activityIdToRowIndex.get(activityId);
                if (startRow === undefined) return;

                const rowsText = pastedText.split(/\r?\n/).filter(r => r.length > 0);
                const newData = deepClone(liveData);
                const activityMap = new Map((newData || []).flatMap((g: any) => (g.tarefas || []).flatMap((t: any) => t.activities || [])).map((a: any) => [a.id, a]));

                rowsText.forEach((rowStr, rIdx) => {
                    const targetRowIndex = startRow + rIdx;
                    if (targetRowIndex < renderableRows.length) {
                        const targetActivityId = renderableRows[targetRowIndex].activity?.id;
                        if (!targetActivityId) return;
                        const activityToUpdate = activityMap.get(targetActivityId);
                        if (activityToUpdate) {
                            activityToUpdate.name = rowStr.trim();
                        }
                    }
                });

                dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });
                activeElement.blur();
                return;
            }
        }
    }, [activeCell, liveData, dispatch, renderableRows, dates, activityIdToRowIndex, dateToColIndex, addToast, cutSelectionBlock, getBlockIndices]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('paste', handlePaste);
        return () => {
             window.removeEventListener('keydown', handleKeyDown);
             window.removeEventListener('paste', handlePaste);
        };
    }, [handleKeyDown, handlePaste]);

    return { 
        activeCell, 
        handleCellMouseDown, 
        handleCellMouseEnter,
        handleCellRightClick,
        selectionBlock,
        cutSelectionBlock,
        isMovingBlock,
        ghostBlockCells
    };
};
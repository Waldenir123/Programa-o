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
    
    const activityIdToRowIndex = useMemo(() => new Map(renderableRows.map((r, i) => [r.activity.id, i])), [renderableRows]);
    const dateToColIndex = useMemo(() => new Map(dates.map((d, i) => [formatDate(d), i])), [dates]);

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
        event.preventDefault();

        // Check if clicking inside an existing selection to start a move
        if (selectionBlock && isCellInBlock(activityId, dateStr, selectionBlock)) {
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
        } else if (selectionBlock) {
             setSelectionBlock(prev => prev ? { ...prev, end: newActiveCell } : { anchor: newActiveCell, end: newActiveCell });
        }
    }, [selectionBlock, isCellInBlock]);
    
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
        if (isSelecting) {
            setSelectionBlock(prev => {
                if (!prev || (prev.end.activityId === activityId && prev.end.date === dateStr)) return prev;
                return { ...prev, end: { activityId, date: dateStr } };
            });
        } else if (isMovingBlock && dragStartCell && selectionBlock) {
            const startRow = activityIdToRowIndex.get(dragStartCell.activityId);
            const startCol = dateToColIndex.get(dragStartCell.date);
            const currentRow = activityIdToRowIndex.get(activityId);
            const currentCol = dateToColIndex.get(dateStr);

            if (startRow === undefined || startCol === undefined || currentRow === undefined || currentCol === undefined) return;

            const rowDelta = currentRow - startRow;
            const colDelta = currentCol - startCol;

            // Only update if delta changed
            setGhostBlockCells(prev => {
                const blockIndices = getBlockIndices(selectionBlock);
                if (!blockIndices) return prev;

                const newGhostCells = new Set<string>();
                for (let r = blockIndices.minRow; r <= blockIndices.maxRow; r++) {
                    for (let c = blockIndices.minCol; c <= blockIndices.maxCol; c++) {
                        const targetRow = r + rowDelta;
                        const targetCol = c + colDelta;
                        if (targetRow >= 0 && targetRow < renderableRows.length && targetCol >= 0 && targetCol < dates.length) {
                            const ghostActivityId = renderableRows[targetRow].activity.id;
                            const ghostDateStr = formatDate(dates[targetCol]);
                            newGhostCells.add(`${ghostActivityId}-${ghostDateStr}`);
                        }
                    }
                }
                
                // Very basic check: are sizes same? If so, maybe they are same (not always true but helps)
                // Better check would be to see if delta changed.
                return newGhostCells;
            });
        }
    }, [isSelecting, isMovingBlock, dragStartCell, selectionBlock, getBlockIndices, activityIdToRowIndex, dateToColIndex, renderableRows, dates]);

    const handleGlobalMouseUp = useCallback(() => {
        if (isSelecting) {
            setIsSelecting(false);
            document.body.classList.remove('dragging');
        }
        if (isMovingBlock && dragStartCell && selectionBlock && ghostBlockCells.size > 0) {
            const newData = deepClone(liveData);
            const activityMap = new Map(newData.flatMap(g => g.tarefas.flatMap(t => t.activities)).map(a => [a.id, a]));
            
            const blockIndices = getBlockIndices(selectionBlock);
            if (!blockIndices) return;

            const statusesToMove: (Status | null)[][] = [];
            for (let r = blockIndices.minRow; r <= blockIndices.maxRow; r++) {
                const row: (Status | null)[] = [];
                const sourceActivity = activityMap.get(renderableRows[r].activity.id)!;
                for (let c = blockIndices.minCol; c <= blockIndices.maxCol; c++) {
                    const sourceDateStr = formatDate(dates[c]);
                    row.push(sourceActivity.schedule[sourceDateStr] || null);
                    delete sourceActivity.schedule[sourceDateStr];
                }
                statusesToMove.push(row);
            }
            
            let minGhostRow = Infinity, minGhostCol = Infinity;
            ghostBlockCells.forEach(cellId => {
                const [actId, dateStr] = cellId.split(/(?<=id_\d+_\w+)-/);
                const r = activityIdToRowIndex.get(actId);
                const c = dateToColIndex.get(dateStr);
                if (r !== undefined && r < minGhostRow) minGhostRow = r;
                if (c !== undefined && c < minGhostCol) minGhostCol = c;
            });
            
            statusesToMove.forEach((row, rIdx) => {
                const targetRow = minGhostRow + rIdx;
                if (targetRow < renderableRows.length) {
                    const targetActivity = activityMap.get(renderableRows[targetRow].activity.id)!;
                    row.forEach((status, cIdx) => {
                        const targetCol = minGhostCol + cIdx;
                        if (targetCol < dates.length) {
                            const targetDateStr = formatDate(dates[targetCol]);
                            if (status) targetActivity.schedule[targetDateStr] = status;
                            else delete targetActivity.schedule[targetDateStr];
                        }
                    });
                }
            });
            
            dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });

            const rowDelta = minGhostRow - blockIndices.minRow;
            const colDelta = minGhostCol - blockIndices.minCol;
            const updateCell = (cell: CellIdentifier) => {
                const r = activityIdToRowIndex.get(cell.activityId)! + rowDelta;
                const c = dateToColIndex.get(cell.date)! + colDelta;
                return { activityId: renderableRows[r].activity.id, date: formatDate(dates[c]) };
            };
            const newSelectionBlock = { anchor: updateCell(selectionBlock.anchor), end: updateCell(selectionBlock.end) };
            setSelectionBlock(newSelectionBlock);
            setActiveCell(newSelectionBlock.end);
        }
        
        setIsMovingBlock(false);
        setDragStartCell(null);
        setGhostBlockCells(new Set());
        document.body.classList.remove('dragging');
    }, [isSelecting, isMovingBlock, dragStartCell, selectionBlock, ghostBlockCells, liveData, dispatch, getBlockIndices, activityIdToRowIndex, dateToColIndex, renderableRows, dates]);

    useEffect(() => {
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [handleGlobalMouseUp]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        
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
                    addToast("Copiado!", 'success');
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
                    addToast("Recortado!", 'success');
                    return;
                case 'v':
                    event.preventDefault();
                    if (!clipboard || !activeCell) return;
                    
                    const startRow = activityIdToRowIndex.get(activeCell.activityId);
                    const startCol = dateToColIndex.get(activeCell.date);
                    if (startRow === undefined || startCol === undefined) return;
                    
                    const newData = deepClone(liveData);
                    const activityMap = new Map(newData.flatMap(g => g.tarefas.flatMap(t => t.activities)).map(a => [a.id, a]));
                    
                    clipboard.statuses.forEach((row, rIdx) => {
                        const targetRowIndex = startRow + rIdx;
                        if (targetRowIndex < renderableRows.length) {
                            const targetActivityId = renderableRows[targetRowIndex].activity.id;
                            const activityToUpdate = activityMap.get(targetActivityId);
                            if (activityToUpdate) {
                                row.forEach((status, cIdx) => {
                                    const targetColIndex = startCol + cIdx;
                                    if (targetColIndex < dates.length) {
                                        const targetDateStr = formatDate(dates[targetColIndex]);
                                        if (status) {
                                            activityToUpdate.schedule[targetDateStr] = status;
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
                                const activityToClearId = renderableRows[r].activity.id;
                                const activityToUpdate = activityMap.get(activityToClearId);
                                if (activityToUpdate) {
                                    for (let c = cutIndices.minCol; c <= cutIndices.maxCol; c++) {
                                        const dateToClearStr = formatDate(dates[c]);
                                        delete activityToUpdate.schedule[dateToClearStr];
                                    }
                                }
                            }
                        }
                        setCutSelectionBlock(null);
                        setClipboard(null); // Clear clipboard after cut and paste
                    }
                    
                    dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });
                    addToast("Colado!", 'success');
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
    
    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

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
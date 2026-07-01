import React, { useMemo, useCallback, memo, useState, useEffect, useRef } from 'react';
import { ScheduleData, Status, SelectedItem, Atividade, Grupo, TarefaPrincipal, RenderableRow, STATUS_CLASS_MAP, DynamicColumn, PREDEFINED_SECTORS, getSectorStyle } from '../state/types';
import { formatDate, getDayAbbr, getWeek, cleanText } from '../utils/dataUtils';

// --- Sub-components for better performance ---

interface ScheduleCellProps {
    date: Date;
    activity?: Atividade;
    isActive: boolean;
    isSelected: boolean;
    isCut: boolean;
    isMoving: boolean;
    isGhost: boolean;
    onMouseDown: (e: React.MouseEvent, activityId: string, date: string) => void;
    onMouseEnter: (activityId: string, date: string) => void;
    onRightClick: (e: React.MouseEvent, activityId: string, date: string) => void;
    onDoubleClick: (activityId: string, date: string) => void;
    onAnnotationClick: (e: React.MouseEvent, annotation: string, activityId: string, date: string, rect: DOMRect) => void;
    className?: string;
}

const ScheduleCell = memo(({ 
    date, activity, isActive, isSelected, isCut, isMoving, isGhost, 
    onMouseDown, onMouseEnter, onRightClick, onDoubleClick, onAnnotationClick, className 
}: ScheduleCellProps) => {
    const dateStr = formatDate(date);
    const status = activity ? activity.schedule[dateStr] : undefined;
    const annotation = activity ? activity.annotations?.[dateStr] : undefined;
    const dayAbbr = getDayAbbr(date);
    const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';

    const cellClasses = [
        'status-cell',
        status ? STATUS_CLASS_MAP[status] : '',
        weekendClass,
        isActive ? 'active-cell' : '',
        isSelected ? 'selected-cell' : '',
        isCut ? 'cut-cell' : '',
        isMoving ? 'moving-cell' : '',
        isGhost ? 'ghost-cell' : '',
        className || ''
    ].filter(Boolean).join(' ');

    return (
        <td 
            data-cell-id={activity ? `${activity.id}-${dateStr}` : `empty-${dateStr}`}
            className={cellClasses}
            tabIndex={0}
            onMouseDown={(e) => {
                if (activity) {
                    e.currentTarget.focus();
                    onMouseDown(e, activity.id, dateStr);
                }
            }}
            onMouseEnter={() => activity && onMouseEnter(activity.id, dateStr)}
            onContextMenu={(e) => activity && onRightClick(e, activity.id, dateStr)}
            onDoubleClick={(e) => {
                if (activity) {
                    e.preventDefault();
                    onDoubleClick(activity.id, dateStr);
                }
            }}
            style={{ position: 'relative' }}
        >
           {status && <span className="status-indicator">{status}</span>}
           {annotation && (
               <div 
                   className="annotation-triangle" 
                   onClick={(e) => {
                       if (activity) {
                           e.stopPropagation();
                           onAnnotationClick(e, annotation, activity.id, dateStr, e.currentTarget.getBoundingClientRect());
                       }
                   }}
               />
           )}
        </td>
    );
});

ScheduleCell.displayName = 'ScheduleCell';

interface ScheduleRowProps {
    printNumWeeks?: number;
    row: RenderableRow;
    index: number;
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    stickyColumnPositions: number[];
    visibleColumns?: Record<string, boolean>;
    selectedItems: SelectedItem[];
    draggedGroupInfo: any;
    draggedTaskInfo: any;
    draggedActivityInfo: any;
    dropTargetId: string | null;
    activeCell: { activityId: string; date: string } | null;
    selectionBlock: any;
    cutSelectionBlock: any;
    isMovingBlock: boolean;
    ghostBlockCells: Set<string>;
    onRowClick: (e: React.MouseEvent, item: SelectedItem) => void;
    onGroupDragStart: (group: Grupo, index: number) => void;
    onTaskDragStart: (task: TarefaPrincipal, groupId: string) => void;
    onTaskDrop: (targetGroupId: string, targetTaskId: string | null) => void;
    onActivityDragStart: (activity: Atividade, taskId: string) => void;
    onActivityDrop: (targetTaskId: string, targetActivityId: string | null) => void;
    onDragEnd: () => void;
    onDropTargetChange: (targetId: string | null) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string, insertAfterId?: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onTextUpdate: (id: string, field: string, value: string) => void;
    onDuplicateTask: (taskId: string) => void;
    onCellMouseDown: (e: React.MouseEvent, activityId: string, date: string) => void;
    onCellMouseEnter: (activityId: string, date: string) => void;
    onCellRightClick: (e: React.MouseEvent, activityId: string, date: string) => void;
    onCellDoubleClick: (activityId: string, date: string) => void;
    onAnnotationClick: (e: React.MouseEvent, annotation: string, activityId: string, date: string, rect: DOMRect) => void;
    onWhatsAppClick: (e: React.MouseEvent, activityId: string) => void;
    isCellInBlock: (activityId: string, date: string, block: any) => boolean;
    onMoveItem: (id: string, type: 'task' | 'activity', direction: 'up' | 'down') => void;
    onToggleHideItem: (id: string, type: 'group' | 'task' | 'activity') => void;
}

interface SectorCellProps {
    activity: Atividade | undefined;
    taskId: string;
    columnWidth: number;
    stickyLeft: number;
    stickyIndex: number;
    isVisible: boolean;
    onTextUpdate: (id: string, field: string, value: string) => void;
}

const SectorCell: React.FC<SectorCellProps> = ({
    activity,
    columnWidth,
    stickyLeft,
    stickyIndex,
    isVisible,
    onTextUpdate
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchText, setSearchText] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    if (!isVisible) {
        return (
            <td 
                className={`col-sticky col-sticky-${stickyIndex}`} 
                style={{ display: 'none' }}
            />
        );
    }
    if (!activity) {
        return (
            <td 
                className={`col-sticky col-sticky-${stickyIndex}`} 
                style={{ width: columnWidth, left: stickyLeft, backgroundColor: '#f8fafc', display: 'table-cell' }}
            />
        );
    }

    const currentSector = activity.sector || '';
    const style = getSectorStyle(currentSector);

    const handleSelectOption = (val: string) => {
        onTextUpdate(activity.id, 'sector', val);
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSelectOption(searchText.trim());
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    const filteredSectors = PREDEFINED_SECTORS.filter(s =>
        s.toLowerCase().includes(searchText.toLowerCase())
    );

    const isCustomOptionVisible = searchText.trim() !== '' && 
        !PREDEFINED_SECTORS.some(s => s.toLowerCase() === searchText.trim().toLowerCase());

    return (
        <td 
            className={`col-sticky col-sticky-${stickyIndex}`} 
            style={{ 
                width: columnWidth, 
                left: stickyLeft, 
                verticalAlign: 'middle', 
                userSelect: 'none',
                zIndex: isOpen ? 50 : undefined,
                display: 'table-cell'
            }}
        >
            <div 
                ref={containerRef}
                style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
                <div 
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(true);
                        setSearchText(currentSector);
                    }}
                    style={{
                        backgroundColor: currentSector ? style.background : '#f1f5f9',
                        color: currentSector ? style.color : '#64748b',
                        border: currentSector ? (style.border || '1px solid transparent') : '1px dashed #cbd5e1',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontWeight: '600',
                        fontSize: '11px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        minWidth: '55px',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease'
                    }}
                    title={currentSector || "Clique para definir um setor"}
                >
                    {currentSector || '...'}
                </div>

                {isOpen && (
                    <div 
                        style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 1000,
                            width: '200px',
                            maxHeight: '260px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            marginTop: '4px'
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        onMouseUp={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ padding: '6px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '4px' }}>
                            <input 
                                type="text"
                                autoFocus
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Buscar ou digite setor..."
                                style={{
                                    width: '100%',
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    outline: 'none',
                                    color: '#1e293b'
                                }}
                            />
                            {searchText.trim() && (
                                <button
                                    onClick={() => handleSelectOption(searchText.trim())}
                                    style={{
                                        padding: '4px 8px',
                                        fontSize: '11px',
                                        backgroundColor: '#10b981',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: '500'
                                    }}
                                >
                                    Ok
                                </button>
                            )}
                        </div>

                        <div style={{ overflowY: 'auto', flexGrow: 1, maxHeight: '200px', padding: '4px 0' }}>
                            {currentSector && (
                                <div 
                                    onClick={() => handleSelectOption('')}
                                    style={{
                                        padding: '5px 10px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        color: '#ef4444',
                                        backgroundColor: '#fef2f2',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontWeight: '500',
                                        borderBottom: '1px solid #fee2e2'
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: '14px' }}>clear</span> Limpar Campo
                                </div>
                            )}

                            {isCustomOptionVisible && (
                                <div 
                                    onClick={() => handleSelectOption(searchText.trim())}
                                    style={{
                                        padding: '6px 10px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        backgroundColor: '#eff6ff',
                                        color: '#1d4ed8',
                                        borderBottom: '1px solid #dbeafe',
                                        fontWeight: '600'
                                    }}
                                >
                                    + Adicionar "{searchText.trim()}"
                                </div>
                            )}

                            {filteredSectors.map(sec => {
                                const secStyle = getSectorStyle(sec);
                                return (
                                    <div 
                                        key={sec}
                                        onClick={() => handleSelectOption(sec)}
                                        style={{
                                            padding: '6px 10px',
                                            fontSize: '11px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            backgroundColor: '#ffffff',
                                            transition: 'background-color 0.1s',
                                            color: '#1e293b'
                                        }}
                                        className="hover:bg-slate-100"
                                    >
                                        <span>{sec}</span>
                                        <span style={{
                                            backgroundColor: secStyle.background,
                                            color: secStyle.color,
                                            border: secStyle.border || '1px solid transparent',
                                            padding: '1px 5px',
                                            borderRadius: '3px',
                                            fontSize: '9px',
                                            fontWeight: 'bold'
                                        }}>
                                            Cor
                                        </span>
                                    </div>
                                );
                            })}

                            {filteredSectors.length === 0 && !isCustomOptionVisible && (
                                <div style={{ padding: '8px 12px', fontSize: '11px', color: '#64748b', fontStyle: 'italic', textAlign: 'center' }}>
                                    Nenhum setor encontrado
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </td>
    );
};

const ScheduleRow = memo((props: ScheduleRowProps) => {
    const { 
        printNumWeeks, row, index, dates, dynamicColumns, columnWidths, stickyColumnPositions, visibleColumns,
        selectedItems, draggedGroupInfo, draggedTaskInfo, draggedActivityInfo, dropTargetId, activeCell,
        selectionBlock, cutSelectionBlock, isMovingBlock, ghostBlockCells,
        onRowClick, onGroupDragStart, onTaskDragStart, onTaskDrop, onActivityDragStart, onActivityDrop, onDragEnd, onDropTargetChange,
        onAddItem, onDeleteItem, onTextUpdate,
        onDuplicateTask,
        onCellMouseDown, onCellMouseEnter, onCellRightClick, onCellDoubleClick, onAnnotationClick, onWhatsAppClick, isCellInBlock,
        onMoveItem, onToggleHideItem
    } = props;

    const dynamicColumnsBefore = useMemo(() => (dynamicColumns || []).filter(c => c.position !== 'after'), [dynamicColumns]);
    const dynamicColumnsAfter = useMemo(() => (dynamicColumns || []).filter(c => c.position === 'after'), [dynamicColumns]);

    const { group, task, activity, renderGroup, groupRowSpan, renderTask, taskRowSpan, wbsId, isLastInGroup, isLastInTask } = row;

    const isGroupSelected = selectedItems.some(item => item.type === 'group' && item.id === group.id);
    const isTaskSelected = selectedItems.some(item => item.type === 'task' && item.id === task.id);
    const isActivitySelected = selectedItems.some(item => item.type === 'activity' && item.id === activity?.id);
    const isSelected = isActivitySelected || isTaskSelected || isGroupSelected;
    
    const isGroupBeingDragged = draggedGroupInfo?.group.id === group.id;
    const isTaskBeingDragged = draggedTaskInfo?.task.id === task.id;
    const isActivityBeingDragged = draggedActivityInfo?.activity.id === activity?.id;
    const isDropTarget = dropTargetId === group.id || dropTargetId === task.id || (dropTargetId === activity?.id); // dropTargetId handles both group, task, and activity drops by id

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        // Insert plain text at the cursor position
        document.execCommand('insertText', false, text);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
        }
    };

    return (
        <tr
            className={`${isSelected ? 'selected-row' : ''} ${isLastInGroup ? 'group-divider' : ''} ${isLastInTask ? 'task-divider' : ''} ${isGroupBeingDragged || isTaskBeingDragged || isActivityBeingDragged ? 'group-dragging' : ''} ${isDropTarget ? 'drop-target-top' : ''}`}
            style={{ opacity: (group.isHidden || task.isHidden || activity?.isHidden) ? 0.5 : 1, transition: 'opacity 0.2s' }}
            onDragOver={(e) => { 
              e.preventDefault(); 
              if (draggedGroupInfo) onDropTargetChange(group.id);
              if (draggedTaskInfo) onDropTargetChange(task.id);
              if (draggedActivityInfo && activity) onDropTargetChange(activity.id);
              if (draggedActivityInfo && !activity) onDropTargetChange(task.id + '_empty'); // When dropping on empty task
            }}
            onDrop={(e) => {
              if (draggedActivityInfo) {
                 e.preventDefault();
                 onActivityDrop(task.id, activity ? activity.id : null);
              }
              if (draggedTaskInfo) {
                 e.preventDefault();
                 onTaskDrop(group.id, task.id);
              }
            }}
        >
            <td className="col-sticky col-sticky-1 id-cell" style={{ width: columnWidths[0], left: stickyColumnPositions[0], display: visibleColumns && visibleColumns['ID'] === false ? 'none' : 'table-cell' }}>
                <div
                    className="cell-content-wrapper with-drag-handle"
                    onClick={(e) => onRowClick(e, activity ? { id: activity.id, name: activity.name, type: 'activity', wbsId } : { id: task.id, name: task.title, type: 'task', wbsId })}
                >
                    <span
                        className="drag-handle"
                        draggable
                        onDragStart={() => onGroupDragStart(group, index)}
                        onDragEnd={onDragEnd}
                    >
                        <span className="material-icons">drag_indicator</span>
                    </span>
                    {wbsId}
                    <button onClick={(e) => { e.stopPropagation(); onToggleHideItem(group.id, 'group'); }} title={group.isHidden ? "Mostrar Grupo" : "Ocultar Grupo"} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '20px', height: '20px', pointerEvents: 'auto', border: 'none', cursor: 'pointer' }}>
                        <span className="material-icons" style={{ fontSize: '14px', color: group.isHidden ? '#94a3b8' : '#64748b' }}>{group.isHidden ? 'visibility_off' : 'visibility'}</span>
                    </button>
                    <button 
                        className="group-delete-button"
                        onClick={(e) => { e.stopPropagation(); onDeleteItem(group.id, 'group'); }}
                        title="Excluir Grupo"
                        style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '20px', height: '20px', pointerEvents: 'auto', border: 'none', cursor: 'pointer' }}
                    >
                        <span className="material-icons" style={{ fontSize: '14px', color: '#ef4444' }}>remove</span>
                    </button>
                </div>
            </td>
            
            {dynamicColumnsBefore.map((col, idx) => {
                const absIdx = idx + 1;
                const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                const value = group.customValues?.[col.id] || '';

                return (
                    <td 
                        key={col.id} 
                        className={`col-sticky col-sticky-${absIdx + 1}`} 
                        style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }} 
                        onClick={(e) => onRowClick(e, { id: group.id, name: value, type: 'group', wbsId: wbsId.split('.')[0] })}
                    >
                        <div contentEditable suppressContentEditableWarning onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onBlur={e => onTextUpdate(group.id, col.id, e.currentTarget.innerHTML || '')} dangerouslySetInnerHTML={{ __html: cleanText(value) }} />
                    </td>
                );
            })}
            
            {renderTask && (
                <td className={`col-sticky col-sticky-${dynamicColumnsBefore.length + 2}`} rowSpan={taskRowSpan} style={{ width: columnWidths[dynamicColumnsBefore.length + 1], left: stickyColumnPositions[dynamicColumnsBefore.length + 1], display: visibleColumns && visibleColumns['TAREFA PRINCIPAL'] === false ? 'none' : 'table-cell' }} onClick={(e) => onRowClick(e, { id: task.id, name: task.title, type: 'task', wbsId: wbsId.split('.').slice(0, 2).join('.') })}>
                    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        {!task.id.includes('_placeholder_task') && (
                            <span
                                className="drag-handle material-icons"
                                style={{ cursor: 'grab', marginRight: '4px', marginTop: '2px', fontSize: '16px', color: '#cbd5e1' }}
                                draggable
                                onDragStart={(e) => {
                                    e.stopPropagation();
                                    onTaskDragStart(task, group.id);
                                }}
                                onDragEnd={onDragEnd}
                            >
                                drag_indicator
                            </span>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1 }}>
                            <div className="task-title-input" contentEditable suppressContentEditableWarning onPaste={handlePaste} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} onBlur={e => onTextUpdate(task.id, 'tarefa', e.currentTarget.innerHTML || '')} style={{ fontWeight: '500' }} dangerouslySetInnerHTML={{ __html: cleanText(task.title) }} />
                            <div className="task-fa-input" contentEditable suppressContentEditableWarning onPaste={handlePaste} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} onBlur={e => onTextUpdate(task.id, 'tarefa_fa', e.currentTarget.innerHTML || '')} style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', borderTop: '1px solid #e2e8f0', paddingTop: '2px' }} dangerouslySetInnerHTML={{ __html: cleanText(task.fa || 'Nº FA') }} />
                        </div>
                    </div>
                    <div className="cell-actions" style={{ display: 'flex', gap: '4px', zIndex: 10 }}>
                        {!task.id.includes('_placeholder_task') && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); onToggleHideItem(task.id, 'task'); }} title={task.isHidden ? "Mostrar Tarefa" : "Ocultar Tarefa"} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: task.isHidden ? '#94a3b8' : '#64748b' }}>{task.isHidden ? 'visibility_off' : 'visibility'}</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onMoveItem(task.id, 'task', 'up'); }} title="Mover para Cima" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_upward</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onMoveItem(task.id, 'task', 'down'); }} title="Mover para Baixo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_downward</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onDuplicateTask(task.id); }} title="Duplicar Tarefa Principal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: '#3b82f6' }}>content_copy</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onAddItem('activity', task.id); }} title="Adicionar Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: '#10b981' }}>add</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onDeleteItem(task.id, 'task'); }} title="Excluir Tarefa" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                    <span className="material-icons" style={{ fontSize: '16px', color: '#ef4444' }}>remove</span>
                                </button>
                            </>
                        )}
                        {task.id.includes('_placeholder_task') && (
                            <button onClick={(e) => { e.stopPropagation(); onAddItem('task', group.id); }} title="Adicionar Tarefa" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#10b981' }}>add</span>
                            </button>
                        )}
                    </div>
                </td>
            )}

            {dynamicColumnsAfter.map((col, idx) => {
                const absIdx = dynamicColumnsBefore.length + 2 + idx;
                const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                const value = group.customValues?.[col.id] || '';

                return (
                    <td 
                        key={col.id} 
                        className={`col-sticky col-sticky-${absIdx + 1}`} 
                        style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }} 
                        onClick={(e) => onRowClick(e, { id: group.id, name: value, type: 'group', wbsId: wbsId.split('.')[0] })}
                    >
                        <div contentEditable suppressContentEditableWarning onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onBlur={e => onTextUpdate(group.id, col.id, e.currentTarget.innerHTML || '')} dangerouslySetInnerHTML={{ __html: cleanText(value) }} />
                    </td>
                );
            })}
            
            <td className={`col-sticky col-sticky-${dynamicColumns.length + 3}`} style={{ width: columnWidths[dynamicColumns.length + 2], left: stickyColumnPositions[dynamicColumns.length + 2], display: visibleColumns && visibleColumns['ATIVIDADE'] === false ? 'none' : 'table-cell' }} onClick={(e) => activity && onRowClick(e, { id: activity.id, name: activity.name, type: 'activity', wbsId })}>
                 <div style={{ display: 'flex', alignItems: 'center' }}>
                     {activity && (
                         <span
                             className="drag-handle material-icons"
                             style={{ cursor: 'grab', marginRight: '4px', fontSize: '16px', color: '#cbd5e1' }}
                             draggable
                             onDragStart={(e) => {
                                 // Stop propagation to prevent group drag from triggering
                                 e.stopPropagation();
                                 onActivityDragStart(activity, task.id);
                             }}
                             onDragEnd={onDragEnd}
                         >
                             drag_indicator
                         </span>
                     )}
                     {activity ? (
                         <div data-activity-id={activity.id} data-column-type="atividade" contentEditable={true} suppressContentEditableWarning onPaste={handlePaste} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} onBlur={e => onTextUpdate(activity.id, 'atividade', e.currentTarget.innerHTML || '')} style={{ flexGrow: 1, minHeight: '1.2em' }} dangerouslySetInnerHTML={{ __html: cleanText(activity.name) }} />
                     ) : (
                         <div data-column-type="atividade" style={{ flexGrow: 1, minHeight: '1.2em' }}>
                             <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>(Sem atividades)</span>
                         </div>
                     )}
                 </div>
                <div className="cell-actions" style={{ display: 'flex', gap: '4px', zIndex: 10 }}>
                    {activity && (
                        <>
                            <button onClick={(e) => onWhatsAppClick(e, activity.id)} title="Perguntar status via WhatsApp" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto', border: '1px solid #cbd5e1' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-message-circle"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onToggleHideItem(activity.id, 'activity'); }} title={activity.isHidden ? "Mostrar Atividade" : "Ocultar Atividade"} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: activity.isHidden ? '#94a3b8' : '#64748b' }}>{activity.isHidden ? 'visibility_off' : 'visibility'}</span>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onMoveItem(activity.id, 'activity', 'up'); }} title="Mover para Cima" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_upward</span>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onMoveItem(activity.id, 'activity', 'down'); }} title="Mover para Baixo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_downward</span>
                            </button>
                        </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onAddItem('activity', task.id, activity?.id); }} title="Adicionar Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                        <span className="material-icons" style={{ fontSize: '18px', color: '#10b981' }}>add</span>
                    </button>
                    {activity && (
                        <button onClick={(e) => { e.stopPropagation(); onDeleteItem(activity.id, 'activity'); }} title="Excluir Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#ef4444' }}>remove</span>
                        </button>
                    )}
                </div>
            </td>
            <SectorCell
                activity={activity}
                taskId={task.id}
                columnWidth={columnWidths[dynamicColumns.length + 3]}
                stickyLeft={stickyColumnPositions[dynamicColumns.length + 3]}
                stickyIndex={dynamicColumns.length + 4}
                isVisible={visibleColumns ? visibleColumns['SETOR'] !== false : true}
                onTextUpdate={onTextUpdate}
            />
            {(dates || []).map((date, dateIndex) => {
                const isPrintable = printNumWeeks === undefined || dateIndex < printNumWeeks * 7;
                const dateStr = formatDate(date);
                const isSelectedInBlock = activity ? isCellInBlock(activity.id, dateStr, selectionBlock) : false;
                return (
                    <ScheduleCell
                        key={dateStr}
                        date={date}
                        activity={activity}
                        isActive={activity ? activeCell?.activityId === activity.id && activeCell.date === dateStr : false}
                        isSelected={isSelectedInBlock}
                        isCut={activity ? isCellInBlock(activity.id, dateStr, cutSelectionBlock) : false}
                        isMoving={isMovingBlock && isSelectedInBlock}
                        isGhost={activity ? ghostBlockCells.has(`${activity.id}|${dateStr}`) : false}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                        onRightClick={onCellRightClick}
                        onDoubleClick={onCellDoubleClick}
                        onAnnotationClick={onAnnotationClick}
                        className={isPrintable ? '' : 'no-print'}
                    />
                );
            })}
        </tr>
    );
});

const areScheduleRowEqual = (prevProps: ScheduleRowProps, nextProps: ScheduleRowProps) => {
    if (prevProps.row !== nextProps.row) return false;
    if (prevProps.index !== nextProps.index) return false;
    if (prevProps.printNumWeeks !== nextProps.printNumWeeks) return false;
    if (prevProps.dropTargetId !== nextProps.dropTargetId) return false;
    if (prevProps.isMovingBlock !== nextProps.isMovingBlock) return false;
    if (prevProps.dates !== nextProps.dates) return false;

    const activityId = prevProps.row.activity?.id;
    if (activityId) {
        const wasActive = prevProps.activeCell?.activityId === activityId;
        const isActive = nextProps.activeCell?.activityId === activityId;
        if (wasActive !== isActive) return false;
        
        if (prevProps.selectionBlock !== nextProps.selectionBlock) {
            const wasInOld = prevProps.dates.some(d => prevProps.isCellInBlock(activityId, formatDate(d), prevProps.selectionBlock));
            const isInNew = nextProps.dates.some(d => nextProps.isCellInBlock(activityId, formatDate(d), nextProps.selectionBlock));
            if (wasInOld || isInNew) return false;
        }

        if (prevProps.cutSelectionBlock !== nextProps.cutSelectionBlock) {
            const wasInOld = prevProps.dates.some(d => prevProps.isCellInBlock(activityId, formatDate(d), prevProps.cutSelectionBlock));
            const isInNew = nextProps.dates.some(d => nextProps.isCellInBlock(activityId, formatDate(d), nextProps.cutSelectionBlock));
            if (wasInOld || isInNew) return false;
        }
        
        if (prevProps.ghostBlockCells !== nextProps.ghostBlockCells) {
            let oldGhost = false, newGhost = false;
            for (const val of prevProps.ghostBlockCells) { if (val.startsWith(activityId + '|')) { oldGhost = true; break; } }
            for (const val of nextProps.ghostBlockCells) { if (val.startsWith(activityId + '|')) { newGhost = true; break; } }
            if (oldGhost || newGhost) return false;
        }
    }
    
    const groupChanged = (prevProps.draggedGroupInfo?.group?.id === prevProps.row.group.id) !== (nextProps.draggedGroupInfo?.group?.id === nextProps.row.group.id);
    const taskChanged = (prevProps.draggedTaskInfo?.task?.id === prevProps.row.task.id) !== (nextProps.draggedTaskInfo?.task?.id === nextProps.row.task.id);
    const activityChanged = activityId && ((prevProps.draggedActivityInfo?.activity?.id === activityId) !== (nextProps.draggedActivityInfo?.activity?.id === activityId));
    if (groupChanged || taskChanged || activityChanged) return false;
    
    if (prevProps.selectedItems !== nextProps.selectedItems) {
        const checkSelected = (items: SelectedItem[]) => items.some(i => i.id === prevProps.row.group.id || i.id === prevProps.row.task.id || (activityId && i.id === activityId));
        if (checkSelected(prevProps.selectedItems) !== checkSelected(nextProps.selectedItems)) return false;
    }

    return true;
};

// Re-assign memo with custom comparison function
const MemoizedScheduleRow = memo(ScheduleRow.type || ScheduleRow, areScheduleRowEqual);
MemoizedScheduleRow.displayName = 'ScheduleRow';

// --- Schedule Header Component ---
interface ScheduleHeaderProps {
    printNumWeeks?: number;
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    onResizeStart: (columnIndex: number, e: React.MouseEvent) => void;
    stickyColumnPositions: number[];
    onOpenFilter: (column: string, rect: DOMRect) => void;
    activeFilters: Record<string, Set<string>>;
    visibleColumns?: Record<string, boolean>;
    onColumnNameUpdate: (colId: string, name: string) => void;
    onAddColumn: (position?: 'before' | 'after') => void;
    onRemoveColumn: (colId: string) => void;
    onMoveColumn: (colId: string, direction: 'left' | 'right') => void;
}

export const ScheduleHeader: React.FC<ScheduleHeaderProps> = ({ 
    printNumWeeks, dates, dynamicColumns, columnWidths, onResizeStart, stickyColumnPositions, 
    onOpenFilter, activeFilters, visibleColumns,
    onColumnNameUpdate, onAddColumn, onRemoveColumn, onMoveColumn
}) => {
    
    const dynamicColumnsBefore = useMemo(() => (dynamicColumns || []).filter(c => c.position !== 'after'), [dynamicColumns]);
    const dynamicColumnsAfter = useMemo(() => (dynamicColumns || []).filter(c => c.position === 'after'), [dynamicColumns]);

    const weekSpans = useMemo(() => {
        if (dates.length === 0) return [];
        const spans: { week: number; count: number }[] = [];
        let currentWeek = getWeek(dates[0]);
        let count = 0;
        dates.forEach(date => {
            const week = getWeek(date);
            if (week === currentWeek) {
                count++;
            } else {
                spans.push({ week: currentWeek, count });
                currentWeek = week;
                count = 1;
            }
        });
        spans.push({ week: currentWeek, count });
        return spans;
    }, [dates]);

    return (
        <thead>
            <tr>
                <th
                    rowSpan={3}
                    style={{ width: columnWidths[0], left: stickyColumnPositions[0], display: visibleColumns && visibleColumns['ID'] === false ? 'none' : 'table-cell' }}
                    className="col-sticky col-sticky-1"
                >
                    <div className="header-content">
                        <span>ID</span>
                        <div className="col-header-actions">
                            <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                        </div>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(0, e)}></div>
                </th>

                {dynamicColumnsBefore.map((col, idx) => {
                    const absIdx = idx + 1;
                    const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                    return (
                        <th
                            key={col.id}
                            rowSpan={3}
                            style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }}
                            className={`col-sticky col-sticky-${absIdx + 1}`}
                        >
                            <div className="header-content">
                                <input
                                    className="column-name-input"
                                    value={col.name || ''}
                                    onChange={(e) => onColumnNameUpdate(col.id, e.target.value)}
                                    title="Clique para renomear"
                                />
                                <div className="col-header-actions">
                                    <button onClick={() => onMoveColumn(col.id, 'left')} title="Mover para esquerda"><i className="material-icons">chevron_left</i></button>
                                    <button onClick={() => onMoveColumn(col.id, 'right')} title="Mover para direita"><i className="material-icons">chevron_right</i></button>
                                    <button onClick={() => onRemoveColumn(col.id)} title="Excluir Coluna" style={{ color: '#ef4444' }}><i className="material-icons">delete</i></button>
                                    <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                                </div>
                                <button
                                    className={`filter-icon-button ${activeFilters[col.id]?.size > 0 ? 'active' : ''}`}
                                    onClick={(e) => onOpenFilter(col.id, e.currentTarget.getBoundingClientRect())}
                                    aria-label={`Filtrar ${col.name}`}
                                >
                                    <span className="material-icons">filter_list</span>
                                </button>
                            </div>
                            <div className="resize-handle" onMouseDown={(e) => onResizeStart(absIdx, e)}></div>
                        </th>
                    );
                })}

                <th
                    rowSpan={3}
                    style={{ width: columnWidths[dynamicColumnsBefore.length + 1], left: stickyColumnPositions[dynamicColumnsBefore.length + 1], display: visibleColumns && visibleColumns['TAREFA PRINCIPAL'] === false ? 'none' : 'table-cell' }}
                    className={`col-sticky col-sticky-${dynamicColumnsBefore.length + 2}`}
                >
                    <div className="header-content">
                        <span>TAREFA PRINCIPAL</span>
                        <div className="col-header-actions">
                           <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                           <button onClick={() => onAddColumn('after')} title="Adicionar Coluna Depois" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                        </div>
                        <button
                            className={`filter-icon-button ${activeFilters['tarefaPrincipal']?.size > 0 ? 'active' : ''}`}
                            onClick={(e) => onOpenFilter('tarefaPrincipal', e.currentTarget.getBoundingClientRect())}
                            aria-label="Filtrar Tarefa Principal"
                        >
                            <span className="material-icons">filter_list</span>
                        </button>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(dynamicColumnsBefore.length + 1, e)}></div>
                </th>

                {dynamicColumnsAfter.map((col, idx) => {
                    const absIdx = dynamicColumnsBefore.length + 2 + idx;
                    const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                    return (
                        <th
                            key={col.id}
                            rowSpan={3}
                            style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }}
                            className={`col-sticky col-sticky-${absIdx + 1}`}
                        >
                            <div className="header-content">
                                <input
                                    className="column-name-input"
                                    value={col.name || ''}
                                    onChange={(e) => onColumnNameUpdate(col.id, e.target.value)}
                                    title="Clique para renomear"
                                />
                                <div className="col-header-actions">
                                    <button onClick={() => onMoveColumn(col.id, 'left')} title="Mover para esquerda"><i className="material-icons">chevron_left</i></button>
                                    <button onClick={() => onMoveColumn(col.id, 'right')} title="Mover para direita"><i className="material-icons">chevron_right</i></button>
                                    <button onClick={() => onRemoveColumn(col.id)} title="Excluir Coluna" style={{ color: '#ef4444' }}><i className="material-icons">delete</i></button>
                                    <button onClick={() => onAddColumn('after')} title="Adicionar Coluna Depois" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                                </div>
                                <button
                                    className={`filter-icon-button ${activeFilters[col.id]?.size > 0 ? 'active' : ''}`}
                                    onClick={(e) => onOpenFilter(col.id, e.currentTarget.getBoundingClientRect())}
                                    aria-label={`Filtrar ${col.name}`}
                                >
                                    <span className="material-icons">filter_list</span>
                                </button>
                            </div>
                            <div className="resize-handle" onMouseDown={(e) => onResizeStart(absIdx, e)}></div>
                        </th>
                    );
                })}

                <th
                    rowSpan={3}
                    style={{ width: columnWidths[dynamicColumns.length + 2], left: stickyColumnPositions[dynamicColumns.length + 2], display: visibleColumns && visibleColumns['ATIVIDADE'] === false ? 'none' : 'table-cell' }}
                    className={`col-sticky col-sticky-${dynamicColumns.length + 3}`}
                >
                    <div className="header-content">
                        <span>ATIVIDADE</span>
                        <button
                            className={`filter-icon-button ${activeFilters['atividade']?.size > 0 ? 'active' : ''}`}
                            onClick={(e) => onOpenFilter('atividade', e.currentTarget.getBoundingClientRect())}
                            aria-label="Filtrar Atividade"
                        >
                            <span className="material-icons">filter_list</span>
                        </button>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(dynamicColumns.length + 2, e)}></div>
                </th>

                <th
                    rowSpan={3}
                    style={{ width: columnWidths[dynamicColumns.length + 3], left: stickyColumnPositions[dynamicColumns.length + 3], display: visibleColumns && visibleColumns['SETOR'] === false ? 'none' : 'table-cell' }}
                    className={`col-sticky col-sticky-${dynamicColumns.length + 4}`}
                >
                    <div className="header-content">
                        <span>SETOR</span>
                        <button
                            className={`filter-icon-button ${activeFilters['sector']?.size > 0 ? 'active' : ''}`}
                            onClick={(e) => onOpenFilter('sector', e.currentTarget.getBoundingClientRect())}
                            aria-label="Filtrar Setor"
                        >
                            <span className="material-icons">filter_list</span>
                        </button>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(dynamicColumns.length + 3, e)}></div>
                </th>

                {weekSpans.map((span, index) => {
                    const isPrintable = printNumWeeks === undefined || index < printNumWeeks;
                    return (
                        <th key={`week-${span.week}`} colSpan={span.count} className={`week-header ${isPrintable ? '' : 'no-print'}`}>
                            Semana {span.week}
                        </th>
                    );
                })}
            </tr>
            <tr>
                {dates.map((date, index) => {
                    const isPrintable = printNumWeeks === undefined || index < printNumWeeks * 7;
                    const dayAbbr = getDayAbbr(date);
                    const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                    const weekendClass = isWeekend ? 'saturday-col' : '';
                    return <th key={`day-${formatDate(date)}`} className={`${weekendClass} ${isPrintable ? '' : 'no-print'}`}>{dayAbbr}</th>
                })}
            </tr>
            <tr>
                {dates.map((date, index) => {
                    const isPrintable = printNumWeeks === undefined || index < printNumWeeks * 7;
                    const dayAbbr = getDayAbbr(date);
                    const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                    const weekendClass = isWeekend ? 'saturday-col' : '';
                    return <th key={`date-${formatDate(date)}`} className={`${weekendClass} ${isPrintable ? '' : 'no-print'}`}>{date.getUTCDate()}</th>
                })}
            </tr>
        </thead>
    );
};

// --- Schedule Body Component ---
interface ScheduleBodyProps {
    printNumWeeks?: number;
    renderableRows: RenderableRow[];
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    stickyColumnPositions: number[];
    selectedItems: SelectedItem[];
    onRowClick: (event: React.MouseEvent, item: SelectedItem) => void;
    activeCell: { activityId: string; date: string; } | null;
    onCellMouseDown: (event: React.MouseEvent, activityId: string, date: string) => void;
    onCellMouseEnter: (activityId: string, date: string) => void;
    onCellRightClick: (event: React.MouseEvent, activityId: string, date: string) => void;
    onCellDoubleClick: (activityId: string, date: string) => void;
    onAnnotationClick: (e: React.MouseEvent, annotation: string, activityId: string, date: string, rect: DOMRect) => void;
    onWhatsAppClick: (e: React.MouseEvent, activityId: string) => void;
    selectionBlock: { anchor: { activityId: string; date: string; }; end: { activityId: string; date: string; }; } | null;
    cutSelectionBlock: { anchor: { activityId: string; date: string; }; end: { activityId: string; date: string; }; } | null;
    isMovingBlock: boolean;
    ghostBlockCells: Set<string>;
    onTextUpdate: (id: string, field: string, value: string) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string, insertAfterId?: string) => void;
    onDuplicateTask: (taskId: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onMoveItem: (id: string, type: 'task' | 'activity', direction: 'up' | 'down') => void;
    draggedGroupInfo: { group: Grupo, index: number } | null;
    draggedTaskInfo: { task: TarefaPrincipal, groupId: string } | null;
    draggedActivityInfo: { activity: Atividade, taskId: string } | null;
    onGroupDragStart: (group: Grupo, index: number) => void;
    onGroupDrop: () => void;
    onTaskDragStart: (task: TarefaPrincipal, groupId: string) => void;
    onTaskDrop: (targetGroupId: string, targetTaskId: string | null) => void;
    onActivityDragStart: (activity: Atividade, taskId: string) => void;
    onActivityDrop: (targetTaskId: string, targetActivityId: string | null) => void;
    onDragEnd: () => void;
    onDropTargetChange: (id: string | null) => void;
    dropTargetId: string | null;
    visibleColumns?: Record<string, boolean>;
    onToggleHideItem: (id: string, type: 'group' | 'task' | 'activity') => void;
}

export const ScheduleBody: React.FC<ScheduleBodyProps> = (props) => {
    const { 
        printNumWeeks, renderableRows, dates, dynamicColumns, columnWidths, stickyColumnPositions, 
        selectedItems, onRowClick, activeCell, onCellMouseDown, onCellMouseEnter, onCellRightClick, onCellDoubleClick, onAnnotationClick, onWhatsAppClick,
        selectionBlock, cutSelectionBlock, isMovingBlock, ghostBlockCells,
        onTextUpdate, onAddItem, onDeleteItem, onMoveItem, onDuplicateTask,
        draggedGroupInfo, draggedTaskInfo, draggedActivityInfo, onGroupDragStart, onGroupDrop, 
        onTaskDragStart, onTaskDrop,
        onActivityDragStart, onActivityDrop,
        onDragEnd, onDropTargetChange, dropTargetId,
        visibleColumns, onToggleHideItem
    } = props;

    const activityIdToRowIndex = useMemo(() => {
       const map = new Map<string, number>();
       renderableRows.forEach((r, i) => {
           if (r.activity) map.set(r.activity.id, i);
       });
       return map;
    }, [renderableRows]);
    const dateToColIndex = useMemo(() => new Map((dates || []).map((d, i) => [formatDate(d), i])), [dates]);
    
    const isCellInBlock = useCallback((activityId: string, dateStr: string, block: typeof selectionBlock) => {
        if (!block) return false;
        
        const currentRow = activityIdToRowIndex.get(activityId);
        const currentCol = dateToColIndex.get(dateStr);
        if (currentRow === undefined || currentCol === undefined) return false;
        
        const anchorRow = activityIdToRowIndex.get(block.anchor.activityId);
        const anchorCol = dateToColIndex.get(block.anchor.date);
        const endRow = activityIdToRowIndex.get(block.end.activityId);
        const endCol = dateToColIndex.get(block.end.date);
        if (anchorRow === undefined || anchorCol === undefined || endRow === undefined || endCol === undefined) return false;
        
        const minRow = Math.min(anchorRow, endRow);
        const maxRow = Math.max(anchorRow, endRow);
        const minCol = Math.min(anchorCol, endCol);
        const maxCol = Math.max(anchorCol, endCol);

        return currentRow >= minRow && currentRow <= maxRow && currentCol >= minCol && currentCol <= maxCol;
    }, [activityIdToRowIndex, dateToColIndex]);

    return (
        <tbody onMouseUp={onGroupDrop}>
             {(renderableRows || []).map((row, index) => (
                <MemoizedScheduleRow
                    key={row.activity?.id || `empty-${row.task.id}-${index}`}
                    printNumWeeks={printNumWeeks}
                    index={index}
                    row={row}
                    dates={dates}
                    dynamicColumns={dynamicColumns}
                    columnWidths={columnWidths}
                    stickyColumnPositions={stickyColumnPositions}
                    visibleColumns={visibleColumns}
                    selectedItems={selectedItems}
                    draggedGroupInfo={draggedGroupInfo}
                    draggedTaskInfo={draggedTaskInfo}
                    draggedActivityInfo={draggedActivityInfo}
                    dropTargetId={dropTargetId}
                    activeCell={activeCell}
                    selectionBlock={selectionBlock}
                    cutSelectionBlock={cutSelectionBlock}
                    isMovingBlock={isMovingBlock}
                    ghostBlockCells={ghostBlockCells}
                    onRowClick={onRowClick}
                    onGroupDragStart={onGroupDragStart}
                    onTaskDragStart={onTaskDragStart}
                    onTaskDrop={onTaskDrop}
                    onActivityDragStart={onActivityDragStart}
                    onActivityDrop={onActivityDrop}
                    onDragEnd={onDragEnd}
                    onDropTargetChange={onDropTargetChange}
                    onAddItem={onAddItem}
                    onDuplicateTask={onDuplicateTask}
                    onDeleteItem={onDeleteItem}
                    onMoveItem={onMoveItem}
                    onTextUpdate={onTextUpdate}
                    onCellMouseDown={onCellMouseDown}
                    onCellMouseEnter={onCellMouseEnter}
                    onCellRightClick={onCellRightClick}
                    onCellDoubleClick={onCellDoubleClick}
                    onAnnotationClick={onAnnotationClick}
                    onWhatsAppClick={onWhatsAppClick}
                    isCellInBlock={isCellInBlock}
                    onToggleHideItem={onToggleHideItem}
                />
            ))}
            <tr className="add-group-row" onDragOver={(e) => { e.preventDefault(); onDropTargetChange(null); }}>
                <td colSpan={columnWidths.length + dates.length} className={`add-group-cell ${dropTargetId === null ? 'drop-target-end' : ''}`}>
                    <button className="add-group-button" onClick={() => onAddItem('group')}>
                        <span className="material-icons">add</span> Adicionar Novo Grupo (Fase/FA)
                    </button>
                </td>
            </tr>
        </tbody>
    );
};

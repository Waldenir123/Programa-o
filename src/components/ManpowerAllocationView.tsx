import React, { useMemo, useState } from 'react';
import { Project, MANPOWER_CATEGORIES, ManpowerAllocation } from '../state/types';
import { getWeekYear, getDateRangeOfWeek } from '../utils/dataUtils';
import { exportManpowerToPdfAgent } from '../utils/exportAgents';

export const ManpowerAllocationView: React.FC<{
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    dates: Date[];
    title: string;
    zoomLevel: number;
}> = ({ project, setProject, dates, title, zoomLevel }) => {
    const [hideUnallocated, setHideUnallocated] = useState(false);
    const [newRoleName, setNewRoleName] = useState('');

    const weeks = useMemo(() => {
        const weekSet = new Set<string>();
        dates.forEach(date => weekSet.add(getWeekYear(date)));
        return Array.from(weekSet).sort();
    }, [dates]);

    const handleAllocationChange = (shift: 'adm' | 'shift2', role: string, weekYear: string, value: string) => {
        const quantity = Math.max(0, parseInt(value, 10) || 0); // Ensure value is not negative
        setProject(prev => {
            if (!prev) return null;
            const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
            if (!newAllocation.data[shift][role]) newAllocation.data[shift][role] = {};
            newAllocation.data[shift][role][weekYear] = quantity;
            return { ...prev, manpowerAllocation: newAllocation };
        });
    };
    
    const handleAddNewRole = () => {
        if (!newRoleName.trim() || project.manpowerAllocation.roles.includes(newRoleName.trim())) {
            // Optionally, add a toast message for duplicate/empty role
            return;
        }
        setProject(prev => {
            if (!prev) return null;
            const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
            newAllocation.roles.push(newRoleName.trim());
            // Initialize data for the new role
            newAllocation.data.adm[newRoleName.trim()] = {};
            newAllocation.data.shift2[newRoleName.trim()] = {};
            return { ...prev, manpowerAllocation: newAllocation };
        });
        setNewRoleName('');
    };

    const handleRemoveRole = (roleToRemove: string) => {
        if (window.confirm(`Tem certeza que deseja remover "${roleToRemove}"? Toda a alocação para esta função será perdida.`)) {
            setProject(prev => {
                if (!prev) return null;
                const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
                newAllocation.roles = newAllocation.roles.filter((r: string) => r !== roleToRemove);
                delete newAllocation.data.adm[roleToRemove];
                delete newAllocation.data.shift2[roleToRemove];
                return { ...prev, manpowerAllocation: newAllocation };
            });
        }
    };

    const handleSecondShiftToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProject(prev => {
            if (!prev) return null;
            const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
            newAllocation.hasSecondShift = e.target.checked;
            return { ...prev, manpowerAllocation: newAllocation };
        });
    };
    
    const handleExport = () => {
        exportManpowerToPdfAgent(project.manpowerAllocation.roles, project.manpowerAllocation.data, project.manpowerAllocation.hasSecondShift, weeks, title);
    };

    const handleRepeatAllocation = (shift: 'adm' | 'shift2', role: string) => {
        if (weeks.length < 2) return; // Nothing to repeat

        setProject(prev => {
            if (!prev) return null;
            const firstWeek = weeks[0];
            const quantityToRepeat = prev.manpowerAllocation.data[shift][role]?.[firstWeek] || 0;
            const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
            
            for (let i = 1; i < weeks.length; i++) {
                const weekYear = weeks[i];
                if (!newAllocation.data[shift][role]) {
                    newAllocation.data[shift][role] = {};
                }
                newAllocation.data[shift][role][weekYear] = quantityToRepeat;
            }
            return { ...prev, manpowerAllocation: newAllocation };
        });
    };

    const handleRepeatPreviousWeek = (shift: 'adm' | 'shift2', targetWeekIndex: number) => {
        if (targetWeekIndex < 1 || targetWeekIndex >= weeks.length) return;

        const sourceWeek = weeks[targetWeekIndex - 1];
        const targetWeek = weeks[targetWeekIndex];

        setProject(prev => {
            if (!prev) return null;
            const newAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
            
            newAllocation.roles.forEach((role: string) => {
                const quantityToCopy = newAllocation.data[shift][role]?.[sourceWeek] || 0;
                if (!newAllocation.data[shift][role]) {
                    newAllocation.data[shift][role] = {};
                }
                newAllocation.data[shift][role][targetWeek] = quantityToCopy;
            });

            return { ...prev, manpowerAllocation: newAllocation };
        });
    };

    const totals = useMemo(() => {
        const weeklyTotals: { adm: Record<string, number>, shift2: Record<string, number> } = { adm: {}, shift2: {} };
        const roleTotals: { adm: Record<string, number>, shift2: Record<string, number> } = { adm: {}, shift2: {} };
        const grandTotals: { adm: number, shift2: number } = { adm: 0, shift2: 0 };

        (['adm', 'shift2'] as const).forEach(shift => {
            weeks.forEach(week => weeklyTotals[shift][week] = 0);
            project.manpowerAllocation.roles.forEach(role => {
                roleTotals[shift][role] = 0;
                weeks.forEach(week => {
                    const quantity = project.manpowerAllocation.data[shift][role]?.[week] || 0;
                    weeklyTotals[shift][week] += quantity;
                    roleTotals[shift][role] += quantity;
                });
                grandTotals[shift] += roleTotals[shift][role];
            });
        });
        return { weeklyTotals, roleTotals, grandTotals };
    }, [project.manpowerAllocation, weeks]);
    
    const filteredRoles = useMemo(() => {
        if (!hideUnallocated) return project.manpowerAllocation.roles;
        return project.manpowerAllocation.roles.filter(role => {
            const admTotal = totals.roleTotals.adm[role] || 0;
            const shift2Total = totals.roleTotals.shift2[role] || 0;
            return admTotal + shift2Total > 0;
        });
    }, [hideUnallocated, project.manpowerAllocation.roles, totals]);

    const renderTable = (shiftKey: 'adm' | 'shift2') => {
        const shiftData = project.manpowerAllocation.data[shiftKey];
        return (
            <div className="table-wrapper">
                <h3>{shiftKey === 'adm' ? 'Turno ADM' : '2º Turno'}</h3>
                <table className="schedule-table">
                    <thead>
                        <tr>
                            <th style={{width: '250px'}}>Mão de Obra</th>
                            {weeks.map((week, index) => (
                                <th key={week}>
                                    Semana {week.split('-')[1]} ({week.split('-')[0]})
                                    <br/>
                                    {getDateRangeOfWeek(week)}
                                    {index > 0 && (
                                        <button
                                            className="week-header-repeat-btn"
                                            onClick={() => handleRepeatPreviousWeek(shiftKey, index)}
                                            title={`Repetir alocação da semana anterior (Semana ${weeks[index - 1].split('-')[1]})`}
                                        >
                                            <span className="material-icons">repeat</span>
                                        </button>
                                    )}
                                </th>
                            ))}
                            <th>Total (H-Sem)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRoles.map(role => (
                            <tr key={role}>
                                <td className="col-sticky role-cell" style={{left: 0, textAlign: 'left', width: '250px'}}>
                                    <span>{role}</span>
                                     <span className="role-row-actions">
                                        <button onClick={() => handleRepeatAllocation(shiftKey, role)} title="Repetir alocação da primeira semana para as seguintes">
                                            <span className="material-icons" style={{fontSize: '18px'}}>repeat</span>
                                        </button>
                                        <button onClick={() => handleRemoveRole(role)} title="Remover função">
                                            <span className="material-icons" style={{fontSize: '18px'}}>delete</span>
                                        </button>
                                    </span>
                                </td>
                                {weeks.map(week => {
                                    const quantity = shiftData[role]?.[week] || 0;
                                    return (
                                        <td key={week}>
                                            <div className="manpower-control">
                                                <button onClick={() => handleAllocationChange(shiftKey, role, week, (quantity - 1).toString())}>-</button>
                                                <span>{quantity}</span>
                                                <button onClick={() => handleAllocationChange(shiftKey, role, week, (quantity + 1).toString())}>+</button>
                                            </div>
                                        </td>
                                    );
                                })}
                                <td><strong>{totals.roleTotals[shiftKey][role] || 0}</strong></td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td><strong>TOTAL (H-Sem)</strong></td>
                            {weeks.map(week => <td key={week}><strong>{totals.weeklyTotals[shiftKey][week] || 0}</strong></td>)}
                            <td><strong>{totals.grandTotals[shiftKey]}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    return (
        <div className="manpower-view" style={{ zoom: zoomLevel / 100 }}>
            <div className="view-header">
                <h2>Alocação de Mão de Obra por Semana</h2>
                <div className="view-controls">
                    <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <input type="checkbox" checked={!!project.manpowerAllocation.hasSecondShift} onChange={handleSecondShiftToggle} />
                        Habilitar 2º Turno
                    </label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <input type="checkbox" checked={hideUnallocated} onChange={(e) => setHideUnallocated(e.target.checked)} />
                        Ocultar MO não alocada
                    </label>
                    <button className="control-button" onClick={handleExport}>
                        <span className="material-icons">print</span> Imprimir Programação
                    </button>
                </div>
            </div>
            {renderTable('adm')}
            {project.manpowerAllocation.hasSecondShift && renderTable('shift2')}
            <div className="add-role-form">
                <input 
                    type="text" 
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="Digitar outra mão de obra" 
                />
                <button className="submit-button" onClick={handleAddNewRole}>Adicionar</button>
            </div>
        </div>
    );
};
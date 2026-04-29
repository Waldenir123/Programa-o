import React, { useState, useMemo, useEffect } from 'react';

interface FilterDropdownProps {
    columnKey: string;
    allOptions: string[];
    activeSelections: Set<string>;
    onApply: (columnKey: string, selections: Set<string>) => void;
    onClose: () => void;
    position: DOMRect;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({ columnKey, allOptions, activeSelections, onApply, onClose, position }) => {
    const [selections, setSelections] = useState(new Set(activeSelections));
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        setSelections(new Set(activeSelections));
    }, [activeSelections]);

    const filteredOptions = useMemo(() => {
        const safeOptions = allOptions || [];
        if (!searchTerm) return safeOptions;
        return safeOptions.filter(option => option.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [allOptions, searchTerm]);

    const handleToggle = (option: string) => {
        const newSelections = new Set(selections);
        if (newSelections.has(option)) {
            newSelections.delete(option);
        } else {
            newSelections.add(option);
        }
        setSelections(newSelections);
    };

    const handleSelectAll = () => {
        setSelections(new Set(allOptions || []));
    };

    const handleClearAll = () => {
        setSelections(new Set());
    };

    const handleApply = () => {
        onApply(columnKey, selections);
    };

    const dropdownStyle: React.CSSProperties = {
        top: position.bottom + 4,
        left: Math.max(8, Math.min(position.left, window.innerWidth - 288)), // Ensure it stays within viewport
    };

    return (
        <>
            <div className="filter-dropdown-overlay" onClick={onClose}></div>
            <div className="filter-dropdown" style={dropdownStyle}>
                <div className="filter-search">
                    <input
                        type="text"
                        placeholder="Pesquisar..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="filter-quick-actions">
                    <button onClick={handleSelectAll}>Selecionar Tudo</button>
                    <button onClick={handleClearAll}>Limpar Tudo</button>
                </div>
                <ul className="filter-options-list">
                    {filteredOptions.map(option => (
                        <li key={option}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selections.has(option)}
                                    onChange={() => handleToggle(option)}
                                />
                                {option}
                            </label>
                        </li>
                    ))}
                </ul>
                <div className="filter-main-actions">
                    <button className="cancel-button" onClick={onClose}>Cancelar</button>
                    <button className="submit-button" onClick={handleApply}>Aplicar</button>
                </div>
            </div>
        </>
    );
};
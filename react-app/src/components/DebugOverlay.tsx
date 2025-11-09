import { useEffect, useState, useMemo } from 'react';

export const DebugOverlay: React.FC = () => {
    return null;
    const [widths, setWidths] = useState<Record<string, number>>({});

    useEffect(() => {
        const updateWidths = () => {
            setWidths({
                viewport: window.innerWidth,
                htmlOffset: document.documentElement.offsetWidth,
                htmlScroll: document.documentElement.scrollWidth,
                bodyOffset: document.body.offsetWidth,
                bodyScroll: document.body.scrollWidth,
                root: document.getElementById('root')?.offsetWidth || 0,
                container: document.querySelector('.container')?.getBoundingClientRect().width || 0,
                mainContent: document.querySelector('.mainContent')?.getBoundingClientRect().width || 0,
                sidebar: document.querySelector('.sidebar')?.getBoundingClientRect().width || 0,
            });
        };

        updateWidths();
        window.addEventListener('resize', updateWidths);
        const interval = setInterval(updateWidths, 1000);

        return () => {
            window.removeEventListener('resize', updateWidths);
            clearInterval(interval);
        };
    }, []);

    const style = useMemo(() => ({

        position: 'fixed',
        top: 400,
        left: 0,
        background: 'rgba(0,0,0,0.9)',
        color: 'lime',
        padding: '10px',
        fontSize: '10px',
        fontFamily: 'monospace',
        zIndex: 9999,
        maxWidth: '200px',
        pointerEvents: 'none',
        opacity: 0.3,
    }), []);

    return (
        <div style={style as React.CSSProperties} >
            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>WIDTH DEBUG:</div>
            {
                Object.entries(widths).map(([key, value]) => (
                    <div key={key} style={{ color: value > widths.viewport ? 'red' : 'lime' }}>
                        {key}: {Math.round(value)}px
                    </div>
                ))
            }
        </div >
    );
};

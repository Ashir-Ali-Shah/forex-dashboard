import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Zap, BarChart2 } from 'lucide-react';

// Simple pagination component
const PaginationControls = ({ currentPage, totalPages, onPageChange, totalItems }) => {
    return (
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4 bg-white rounded-xl p-4 border border-slate-200">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-indigo-600" />
                Market Overview
                <span className="text-sm font-normal text-slate-500">({totalItems} pairs)</span>
            </h2>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                </button>
                <span className="text-sm text-slate-600 font-medium px-3">
                    Page {currentPage} of {totalPages}
                </span>
                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
                >
                    Next
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

// API Status Banner
const APIStatusBanner = ({ batchSize, lastUpdated, dataSource, nextUpdateIn }) => {
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
    const [countdown, setCountdown] = useState(nextUpdateIn || 300);

    // Update the current time every second
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString());
            if (nextUpdateIn) {
                setCountdown(prev => prev > 0 ? prev - 1 : nextUpdateIn);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [nextUpdateIn]);

    // Reset countdown when lastUpdated changes
    useEffect(() => {
        if (lastUpdated) {
            setCountdown(300); // Reset to 5 minutes
        }
    }, [lastUpdated]);

    const formatCountdown = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-4 mb-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
                <div className="bg-white p-2 rounded-lg shadow-sm relative">
                    <Zap className="w-5 h-5 text-indigo-600" />
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">Live Market Feed</span>
                        <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{currentTime}</span>
                    </div>
                    <div className="text-xs text-slate-600">
                        {dataSource || 'Twelve Data API'} • Last update: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Loading...'}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
                <div className="bg-white px-3 py-1 rounded-full border border-slate-200">
                    <span className="text-slate-500">Batch:</span> <span className="font-mono font-bold text-slate-800">{batchSize}/req</span>
                </div>
                <div className="bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                    <span className="text-blue-700 font-medium">Next: {formatCountdown(countdown)}</span>
                </div>
                <div className="bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-emerald-700 font-bold">Connected</span>
                </div>
            </div>
        </div>
    );
};

export { PaginationControls, APIStatusBanner };

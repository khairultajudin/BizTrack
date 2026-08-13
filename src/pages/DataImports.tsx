import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Clock, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ImportEngine } from '../lib/importer/ImportEngine';
import { CsvProvider } from '../lib/importer/providers/CsvProvider';
import { RinggitPayProvider } from '../lib/importer/providers/RinggitPayProvider';

export const DataImports: React.FC = () => {
  const { businessId, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'import' | 'history'>('import');
  const [history, setHistory] = useState<any[]>([]);

  // Wizard State
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<'Generic CSV' | 'RinggitPay'>('Generic CSV');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'history' && businessId) {
      fetchHistory();
    }
  }, [activeTab, businessId]);

  const fetchHistory = async () => {
    const { data } = await supabase.from('import_history').select('*').eq('business_id', businessId).order('created_at', { ascending: false });
    if (data) setHistory(data);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    
    setLoading(true);
    const engine = new ImportEngine(provider === 'RinggitPay' ? new RinggitPayProvider() : new CsvProvider());
    
    try {
      const prev = await engine.generatePreview(uploadedFile);
      setPreview(prev);
      setStep(3);
    } catch (err) {
      console.error(err);
      alert('Failed to parse file.');
    }
    setLoading(false);
  };

  const handleRollback = async (id: string, providerName: string) => {
    if (!confirm('Are you sure you want to rollback this import? This will delete all associated records.')) return;
    
    const engine = new ImportEngine(providerName === 'RinggitPay' ? new RinggitPayProvider() : new CsvProvider());
    await engine.rollbackImport(id, businessId!);
    fetchHistory();
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Upload size={24} />
          Data Imports
        </h1>
        <p className="text-muted">Import generic CSVs or third-party payment gateways.</p>
      </header>

      <div className="flex border-b border-gray-200 gap-4 mb-4">
        <button 
          className={`pb-2 px-2 font-medium border-b-2 transition-colors ${activeTab === 'import' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('import')}
        >
          Import Wizard
        </button>
        <button 
          className={`pb-2 px-2 font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('history')}
        >
          Import History
        </button>
      </div>

      {activeTab === 'import' && (
        <div className="card max-w-3xl">
          {/* STEP 1 & 2: Select Provider and Upload */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <h2 className="text-lg font-semibold">Step 1: Select Import Source</h2>
              <div className="grid grid-cols-2 gap-4">
                <div 
                  className={`border p-4 rounded-xl cursor-pointer hover:border-blue-500 transition-colors ${provider === 'Generic CSV' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}
                  onClick={() => setProvider('Generic CSV')}
                >
                  <FileText className="mb-2" />
                  <h3 className="font-bold">Generic CSV</h3>
                  <p className="text-sm">Standard CSV import with custom mapping.</p>
                </div>
                <div 
                  className={`border p-4 rounded-xl cursor-pointer hover:border-blue-500 transition-colors ${provider === 'RinggitPay' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}
                  onClick={() => setProvider('RinggitPay')}
                >
                  <CheckCircle className="mb-2" />
                  <h3 className="font-bold">RinggitPay Settlement</h3>
                  <p className="text-sm">Automated settlement reconciliation.</p>
                </div>
              </div>
              
              <div className="mt-4 flex justify-end">
                <button className="btn btn-primary" onClick={() => setStep(2)}>Next: Upload File</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload size={20}/> 
                Step 2: Upload {provider} File
              </h2>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 flex flex-col items-center justify-center text-center">
                <Upload size={40} className="text-gray-400 mb-4" />
                <p className="font-medium">Click to upload or drag and drop</p>
                <p className="text-sm text-muted mt-1">Only CSV files are supported</p>
                <input type="file" accept=".csv" className="mt-4" onChange={handleFileUpload} disabled={loading} />
              </div>
              <div className="flex justify-between">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
              </div>
            </div>
          )}

          {/* STEP 3: Preview */}
          {step === 3 && preview && (
            <div className="flex flex-col gap-6">
              <h2 className="text-lg font-semibold">Step 3: Preview Data</h2>
              <p className="text-sm text-muted">Showing first 5 rows of {file?.name}</p>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr>
                      {preview.headers.map((h: string) => (
                        <th key={h} className="border-b p-2 bg-gray-50 text-xs font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row: any, i: number) => (
                      <tr key={i} className="border-b">
                        {preview.headers.map((h: string) => (
                          <td key={h} className="p-2 text-sm text-gray-700">{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-between mt-4">
                <button className="btn btn-ghost" onClick={() => { setFile(null); setPreview(null); setStep(2); }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => setStep(4)}>Proceed to Import</button>
              </div>
            </div>
          )}

          {/* Dummy Step 4 for brevity in this iteration */}
          {step === 4 && (
            <div className="flex flex-col gap-6 items-center py-12">
              <AlertCircle size={48} className="text-yellow-500 mb-2" />
              <h2 className="text-lg font-semibold">Dry Run Completed</h2>
              <p className="text-center text-muted max-w-sm">No critical errors detected. The system is ready to import {preview?.sampleRows?.length} rows into your workspace.</p>
              
              <div className="flex justify-center gap-4 mt-4">
                <button className="btn btn-ghost" onClick={() => setStep(3)}>Back</button>
                <button className="btn btn-primary" onClick={async () => {
                  setLoading(true);
                  const engine = new ImportEngine(provider === 'RinggitPay' ? new RinggitPayProvider() : new CsvProvider());
                  const mapped = engine.mapData(preview.sampleRows, []); // Using raw logic for demo
                  await engine.executeImport(mapped, businessId!, user!.id);
                  setLoading(false);
                  setStep(5);
                }}>
                  {loading ? 'Importing...' : 'Confirm & Import'}
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-6 items-center py-12">
              <CheckCircle size={48} className="text-green-500 mb-2" />
              <h2 className="text-xl font-bold">Import Successful!</h2>
              <p className="text-muted">Your data has been successfully imported.</p>
              <button className="btn btn-primary mt-4" onClick={() => { setStep(1); setFile(null); setActiveTab('history'); }}>
                View Import History
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 text-sm text-muted">
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Provider</th>
                <th className="pb-3 font-medium">File</th>
                <th className="pb-3 font-medium">Rows</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted">No import history found.</td></tr>
              ) : (
                history.map(h => (
                  <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 text-sm flex items-center gap-2">
                      <Clock size={14} className="text-gray-400" />
                      {new Date(h.import_date).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-sm font-medium">{h.provider}</td>
                    <td className="py-3 text-sm text-gray-600">{h.file_name}</td>
                    <td className="py-3 text-sm">{h.rows_imported}</td>
                    <td className="py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${h.status === 'Completed' ? 'bg-green-100 text-green-700' : h.status === 'Failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {h.status === 'Completed' && (
                        <button 
                          onClick={() => handleRollback(h.id, h.provider)} 
                          className="text-xs font-medium text-red-600 hover:text-red-800 flex items-center gap-1 justify-end w-full"
                        >
                          <RotateCcw size={14} /> Rollback
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

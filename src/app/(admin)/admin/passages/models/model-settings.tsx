'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bot, Save, AlertTriangle, Plus, Trash2, Edit2, X, Check } from 'lucide-react';
import { 
  updateAIModelSettings, 
  saveAvailableAIModels 
} from '@/app/api/admin/settings/actions';
import { AIModelConfig, AIModelOption } from '@/app/api/admin/settings/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function AIModelSettings({ 
  initialSettings, 
  availableModels 
}: { 
  initialSettings: AIModelConfig,
  availableModels: AIModelOption[]
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(initialSettings.modelName);
  const [modelsList, setModelsList] = useState<AIModelOption[]>(availableModels);
  
  // Dialog States
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModelOption | null>(null);
  const [formData, setFormData] = useState<Partial<AIModelOption>>({});

  // CRUD Handlers
  const handleSaveSelection = async () => {
    try {
      setLoading(true);
      await updateAIModelSettings({ modelName: model });
      toast.success('AI Model settings updated successfully');
      router.refresh();
    } catch (error) {
      toast.error('Failed to update settings');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (id === model) {
      toast.error('Cannot delete the currently selected active model.');
      return;
    }
    if (!confirm('Are you sure you want to delete this model?')) return;

    const newList = modelsList.filter(m => m.id !== id);
    setModelsList(newList);
    await saveList(newList);
  };

  const handleEditModel = (model: AIModelOption) => {
    setEditingModel(model);
    setFormData(model);
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setEditingModel(null);
    setFormData({});
    setIsDialogOpen(true);
  };

  const handleDialogSave = async () => {
    if (!formData.id || !formData.name) {
      toast.error('Model ID and Name are required');
      return;
    }

    let newList = [...modelsList];
    
    if (editingModel) {
      // Update existing
      newList = newList.map(m => m.id === editingModel.id ? { ...m, ...formData } as AIModelOption : m);
    } else {
      // Create new
      if (newList.some(m => m.id === formData.id)) {
        toast.error('Model ID already exists');
        return;
      }
      newList.push(formData as AIModelOption);
    }

    setModelsList(newList);
    await saveList(newList);
    setIsDialogOpen(false);
  };

  const saveList = async (list: AIModelOption[]) => {
    try {
      await saveAvailableAIModels(list);
      toast.success('Model list saved successfully');
      router.refresh();
    } catch (error) {
      toast.error('Failed to save model list');
      // Revert optimization would be good here, but for now simple toast
    }
  };

  const selectedModelInfo = modelsList.find(m => m.id === model);

  return (
    <div className="grid gap-8">
      {/* Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-500" />
            Active AI Model Selection
          </CardTitle>
          <CardDescription>
            Select the Gemini model to be used for Passage Generation and OCR tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={model} onValueChange={setModel}>
            <div className="grid gap-4">
              {modelsList.map((option) => (
                <div key={option.id} className={`
                  flex items-start space-x-3 space-y-0 rounded-md border p-4 transition-all
                  ${model === option.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}
                `}>
                  <RadioGroupItem value={option.id} id={option.id} className="mt-1" />
                  <div className="space-y-1 pl-1 w-full">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={option.id} className="font-semibold cursor-pointer">
                        {option.name}
                      </Label>
                      {option.badge && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                          {option.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {option.description}
                    </p>
                     {/* Inline warning display */}
                    {option.warning && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium mt-1.5 bg-amber-50 p-1.5 rounded w-fit">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {option.warning}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </RadioGroup>

          {/* Active Model Warning Footer */}
          {selectedModelInfo?.warning && (
             <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 flex gap-3 items-start">
               <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
               <div className="space-y-1">
                 <h5 className="font-medium leading-none tracking-tight">Active Model Warning</h5>
                 <div className="text-sm opacity-90">
                   {selectedModelInfo.warning}
                 </div>
               </div>
             </div>
          )}

          <div className="flex justify-end pt-4">
            <Button 
              onClick={handleSaveSelection} 
              disabled={loading || model === initialSettings.modelName}
              className="w-full sm:w-auto"
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Management Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1.5">
                <CardTitle>Manage Available Models</CardTitle>
                <CardDescription>Add, edit, or remove models from the selection list.</CardDescription>
            </div>
            <Button size="sm" onClick={handleAddNew} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Add New Model
            </Button>
        </CardHeader>
        <CardContent>
            <div className="rounded-md border divide-y">
                {modelsList.map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-4">
                        <div>
                            <div className="font-medium flex items-center gap-2">
                                {m.name}
                                <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                    {m.id}
                                </span>
                            </div>
                            <div className="text-sm text-muted-foreground mt-0.5">{m.description}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button size="icon" variant="ghost" onClick={() => handleEditModel(m)}>
                                <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteModel(m.id)}>
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}
                {modelsList.length === 0 && (
                     <div className="p-8 text-center text-muted-foreground">
                        No customized models found.
                     </div>
                )}
            </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingModel ? 'Edit AI Model' : 'Add AI Model'}</DialogTitle>
              <DialogDescription>
                Configure the model details. ID must match Google Gemini API model names exactly.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="id">Model ID (Required)</Label>
                <Input 
                    id="id" 
                    placeholder="e.g., gemini-2.0-flash" 
                    value={formData.id || ''} 
                    onChange={e => setFormData({...formData, id: e.target.value})}
                    disabled={!!editingModel} // Don't allow changing ID when editing to prevent drift? Or simple allow. Let's disable for safety if key logic relies on it, but here simple ID change acts like new. Let's allow edit if we want, but usually IDs are fixed. Let's disable for edits.
                />
                {editingModel && <p className="text-xs text-muted-foreground">ID cannot be changed once created. Create a new one if needed.</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Display Name</Label>
                <Input 
                    id="name" 
                    placeholder="e.g., Gemini 2.0 Flash" 
                    value={formData.name || ''} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea 
                    id="description" 
                    placeholder="Brief description..." 
                    value={formData.description || ''} 
                    onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="warning">Warning Message (Optional)</Label>
                <Input 
                    id="warning" 
                    placeholder="e.g. Low quota limit..." 
                    value={formData.warning || ''} 
                    onChange={e => setFormData({...formData, warning: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="badge">Badge Label (Optional)</Label>
                <Input 
                    id="badge" 
                    placeholder="e.g. Recommended" 
                    value={formData.badge || ''} 
                    onChange={e => setFormData({...formData, badge: e.target.value})}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleDialogSave}>Save Model</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}

import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useListRoles, useCreateRole, useListPermissions, getListRolesQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ShieldCheck, Plus, Users, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';

const EMPTY_FORM = { nameEn: '', nameAr: '', description: '', permissions: [] as string[] };

export default function Roles() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();
  const { data: roles, isLoading } = useListRoles();
  const { data: permissions } = useListPermissions();
  const createRole = useCreateRole();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const togglePermission = (key: string) => {
    setForm(p => ({
      ...p,
      permissions: p.permissions.includes(key)
        ? p.permissions.filter(k => k !== key)
        : [...p.permissions, key],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.permissions.length === 0) { setError(t('Select at least one permission.', 'اختر صلاحية واحدة على الأقل.')); return; }
    setSaving(true);
    try {
      await createRole.mutateAsync({ data: { nameEn: form.nameEn, nameAr: form.nameAr, description: form.description || undefined, permissions: form.permissions } });
      qc.invalidateQueries({ queryKey: getListRolesQueryKey() });
      setOpen(false);
      setForm(EMPTY_FORM);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setSaving(false);
    }
  };

  // Group permissions by module
  const grouped = (permissions ?? []).reduce<Record<string, typeof permissions>>((acc, p) => {
    if (!p) return acc;
    const mod = p.module ?? 'other';
    if (!acc[mod]) acc[mod] = [];
    acc[mod]!.push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Create Role Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('Create Role', 'إنشاء دور')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Name (English)', 'الاسم (إنجليزي)')} *</Label>
                <Input value={form.nameEn} onChange={e => setForm(p => ({ ...p, nameEn: e.target.value }))} required placeholder="HR Specialist" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Name (Arabic)', 'الاسم (عربي)')} *</Label>
                <Input value={form.nameAr} onChange={e => setForm(p => ({ ...p, nameAr: e.target.value }))} required placeholder="أخصائي الموارد البشرية" dir="rtl" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('Description', 'الوصف')}</Label>
              <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder={t('Brief description of this role…', 'وصف مختصر لهذا الدور…')} />
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto border rounded-md p-3">
              <p className="text-sm font-medium mb-2">{t('Permissions', 'الصلاحيات')} *</p>
              {Object.entries(grouped).map(([module, perms]) => (
                <div key={module} className="mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 capitalize">{module}</p>
                  <div className="space-y-1.5 ms-1">
                    {perms?.map(p => (
                      <label key={p.key} className="flex items-center gap-2 cursor-pointer group">
                        <Checkbox
                          checked={form.permissions.includes(p.key)}
                          onCheckedChange={() => togglePermission(p.key)}
                        />
                        <span className="text-sm group-hover:text-foreground text-muted-foreground transition-colors">
                          {localName(p.nameEn, p.nameAr, lang)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
              <Button type="submit" disabled={saving}>{saving ? t('Saving…', 'جارٍ الحفظ…') : t('Create Role', 'إنشاء دور')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Roles & Permissions', 'الأدوار والصلاحيات')}</h1>
          <p className="text-muted-foreground mt-1">{t('Manage access control and operational capabilities.', 'إدارة التحكم في الوصول والقدرات التشغيلية.')}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 me-2" />{t('Create Role', 'إنشاء دور')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2 mt-2" /></CardHeader>
            <CardContent><Skeleton className="h-24 w-full" /></CardContent>
          </Card>
        )) : roles?.map(role => (
          <Card key={role.id} className="flex flex-col">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl">{localName(role.nameEn, role.nameAr, lang)}</CardTitle>
                {role.systemRole && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />{t('System', 'نظام')}
                  </Badge>
                )}
              </div>
              {role.description && <CardDescription className="line-clamp-2">{role.description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">{t('Permissions', 'الصلاحيات')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {role.permissions.slice(0, 5).map(p => (
                      <Badge key={p} variant="outline" className="text-xs bg-muted/50 font-normal">{p}</Badge>
                    ))}
                    {role.permissions.length > 5 && (
                      <Badge variant="outline" className="text-xs bg-muted/50 font-normal">+{role.permissions.length - 5} {t('more', 'المزيد')}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t mt-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{role.userCount} {t('Assigned', 'معين')}</span>
                  </div>
                  {!role.systemRole && (
                    <Button variant="link" size="sm" className="px-0 h-auto">{t('Edit Role', 'تعديل الدور')}</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

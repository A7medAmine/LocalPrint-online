import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Settings Helpers
 */
export const getSettings = async () => {
  const { data: rows, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  const settings = {};
  (rows || []).forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (e) {
      settings[row.key] = row.value;
    }
  });
  return settings;
};

export const updateSetting = async (key, value) => {
  const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  const { error } = await supabase.from('settings').upsert(
    { key, value: serializedValue },
    { onConflict: 'key' }
  );
  if (error) throw error;
};

/**
 * Paper Types Helpers
 */
export const getPaperTypes = async () => {
  const { data, error } = await supabase.from('paper_types').select('*').order('sortOrder', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const replaceAllPaperTypes = async (types) => {
  const { error: delError } = await supabase.from('paper_types').delete().neq('id', 'nonexistent');
  if (delError && delError.code !== 'PGRST116') throw delError;
  if (types.length === 0) return;
  const rows = types.map((pt, idx) => ({
    id: pt.id,
    name: pt.name,
    nameAr: pt.nameAr || pt.name,
    colorPerPage: pt.colorPerPage,
    blackWhitePerPage: pt.blackWhitePerPage,
    sortOrder: idx,
  }));
  const { error } = await supabase.from('paper_types').insert(rows);
  if (error) throw error;
};

export const createPaperType = async (pt) => {
  const { data: maxOrderData } = await supabase.from('paper_types').select('sortOrder').order('sortOrder', { ascending: false }).limit(1);
  const maxOrder = maxOrderData?.[0]?.sortOrder ?? -1;
  const newPt = {
    id: pt.id,
    name: pt.name,
    nameAr: pt.nameAr || pt.name,
    colorPerPage: pt.colorPerPage,
    blackWhitePerPage: pt.blackWhitePerPage,
    sortOrder: maxOrder + 1,
  };
  const { error } = await supabase.from('paper_types').insert(newPt);
  if (error) throw error;
  const { data } = await supabase.from('paper_types').select('*').eq('id', pt.id).single();
  return data;
};

export const updatePaperType = async (id, updates) => {
  const setFields = {};
  if (updates.name !== undefined) setFields.name = updates.name;
  if (updates.nameAr !== undefined) setFields.nameAr = updates.nameAr;
  if (updates.colorPerPage !== undefined) setFields.colorPerPage = updates.colorPerPage;
  if (updates.blackWhitePerPage !== undefined) setFields.blackWhitePerPage = updates.blackWhitePerPage;
  if (updates.sortOrder !== undefined) setFields.sortOrder = updates.sortOrder;
  if (Object.keys(setFields).length === 0) return null;
  const { error } = await supabase.from('paper_types').update(setFields).eq('id', id);
  if (error) throw error;
  const { data } = await supabase.from('paper_types').select('*').eq('id', id).single();
  return data;
};

export const deletePaperType = async (id) => {
  const { error } = await supabase.from('paper_types').delete().eq('id', id);
  if (error) throw error;
  const { data: remaining } = await supabase.from('paper_types').select('id').order('sortOrder', { ascending: true });
  for (let i = 0; i < (remaining || []).length; i++) {
    await supabase.from('paper_types').update({ sortOrder: i }).eq('id', remaining[i].id);
  }
};

/**
 * Discount Rules Helpers
 */
export const getDiscountRules = async () => {
  const { data, error } = await supabase.from('discount_rules').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const getActiveDiscountRules = async () => {
  const { data, error } = await supabase.from('discount_rules').select('*').eq('is_active', 1).order('priority', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const createDiscountRule = async (rule) => {
  const { id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active } = rule;
  const { error } = await supabase.from('discount_rules').insert({
    id, name, discount_type,
    discount_value,
    condition_type,
    threshold,
    max_discount_cap: max_discount_cap || null,
    priority: priority || 0,
    is_active: is_active ? 1 : 0,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  return rule;
};

export const updateDiscountRule = async (id, updates) => {
  const setFields = {};
  if (updates.name !== undefined) setFields.name = updates.name;
  if (updates.discount_type !== undefined) setFields.discount_type = updates.discount_type;
  if (updates.discount_value !== undefined) setFields.discount_value = updates.discount_value;
  if (updates.condition_type !== undefined) setFields.condition_type = updates.condition_type;
  if (updates.threshold !== undefined) setFields.threshold = updates.threshold;
  if (updates.max_discount_cap !== undefined) setFields.max_discount_cap = updates.max_discount_cap;
  if (updates.priority !== undefined) setFields.priority = updates.priority;
  if (updates.is_active !== undefined) setFields.is_active = updates.is_active ? 1 : 0;

  if (Object.keys(setFields).length === 0) return null;

  const { error } = await supabase.from('discount_rules').update(setFields).eq('id', id);
  if (error) throw error;
  return { id, ...updates };
};

export const deleteDiscountRule = async (id) => {
  const { error } = await supabase.from('discount_rules').delete().eq('id', id);
  if (error) throw error;
  return id;
};

export { supabase as default };

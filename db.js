import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash } from 'crypto';

// Provide native WebSocket for environments that lack it (Alpine Node < 22)
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: WebSocket },
});

/**
 * Shop Helpers
 */
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'shop';

export const getShopBySlug = async (slug) => {
  const { data, error } = await supabase.from('shops').select('*').eq('slug', slug).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
};

export const getShopByTokenHash = async (tokenHash) => {
  const { data, error } = await supabase.from('shops').select('*').eq('token_hash', tokenHash).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
};

export const createShop = async (name) => {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await getShopBySlug(slug);
    if (!existing) break;
    slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
  }

  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);

  const { error } = await supabase.from('shops').insert({
    id,
    slug,
    name,
    token_hash: tokenHash,
  });
  if (error) throw error;

  return { id, slug, name, token };
};

/**
 * Customer Account Helpers (optional — guest uploads never touch these)
 */
export const getSupabaseUserFromToken = async (token) => {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

const toCamelProfile = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  defaultPaperTypeId: row.default_paper_type_id,
  defaultCopies: row.default_copies,
});

export const getProfile = async (userId) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
};

export const getProfileCamel = async (userId) => {
  const profile = await getProfile(userId);
  return profile ? toCamelProfile(profile) : null;
};

export const upsertProfile = async (userId, fields) => {
  const { error } = await supabase.from('profiles').upsert({ id: userId, ...fields }, { onConflict: 'id' });
  if (error) throw error;
  return getProfileCamel(userId);
};

// Customer's orders across all shops, newest first, with shop name/slug attached.
// No FK relationship is declared between orders.shop_id and shops.id, so this
// can't use PostgREST embedding — fetch orders then batch-lookup shops in JS,
// matching the rest of this file's style.
export const getCustomerOrders = async (userId) => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('uploaddate', { ascending: false });
  if (error) throw error;
  if (!orders || orders.length === 0) return [];

  const shopIds = [...new Set(orders.map(o => o.shop_id))];
  const { data: shops, error: shopsErr } = await supabase
    .from('shops')
    .select('id, name, slug')
    .in('id', shopIds);
  if (shopsErr) throw shopsErr;
  const shopById = Object.fromEntries((shops || []).map(s => [s.id, s]));

  return orders.map(order => ({
    id: order.id,
    fileName: order.filename,
    fileType: order.filetype,
    fileSize: order.filesize,
    uploadDate: order.uploaddate,
    status: order.status,
    pageCount: order.pagecount,
    colorMode: order.colormode,
    copies: order.copies,
    paperType: order.papertype,
    shopName: shopById[order.shop_id]?.name || null,
    shopSlug: shopById[order.shop_id]?.slug || null,
  }));
};

/**
 * Settings Helpers
 */
export const getSettings = async (shopId) => {
  const { data: rows, error } = await supabase.from('settings').select('*').eq('shop_id', shopId);
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

export const updateSetting = async (shopId, key, value) => {
  const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  const { error } = await supabase.from('settings').upsert(
    { shop_id: shopId, key, value: serializedValue },
    { onConflict: 'shop_id,key' }
  );
  if (error) throw error;
};

/**
 * Paper Types Helpers
 */
const toCamelPaperType = (row) => ({
  id: row.id,
  name: row.name,
  nameAr: row.namear,
  colorPerPage: row.colorperpage,
  blackWhitePerPage: row.blackwhiteperpage,
});

export const getPaperTypes = async (shopId) => {
  const { data, error } = await supabase.from('paper_types').select('*').eq('shop_id', shopId).order('sortorder', { ascending: true });
  if (error) throw error;
  return (data || []).map(toCamelPaperType);
};

export const replaceAllPaperTypes = async (shopId, types) => {
  const { error: delError } = await supabase.from('paper_types').delete().eq('shop_id', shopId);
  if (delError && delError.code !== 'PGRST116') throw delError;
  if (types.length === 0) return;
  const rows = types.map((pt, idx) => ({
    id: pt.id,
    shop_id: shopId,
    name: pt.name,
    namear: pt.nameAr || pt.name,
    colorperpage: pt.colorPerPage,
    blackwhiteperpage: pt.blackWhitePerPage,
    sortorder: idx,
  }));
  const { error } = await supabase.from('paper_types').insert(rows);
  if (error) throw error;
};

export const createPaperType = async (shopId, pt) => {
  const { data: maxOrderData } = await supabase.from('paper_types').select('sortorder').eq('shop_id', shopId).order('sortorder', { ascending: false }).limit(1);
  const maxOrder = maxOrderData?.[0]?.sortorder ?? -1;
  const newPt = {
    id: pt.id,
    shop_id: shopId,
    name: pt.name,
    namear: pt.nameAr || pt.name,
    colorperpage: pt.colorPerPage,
    blackwhiteperpage: pt.blackWhitePerPage,
    sortorder: maxOrder + 1,
  };
  const { error } = await supabase.from('paper_types').insert(newPt);
  if (error) throw error;
  const { data } = await supabase.from('paper_types').select('*').eq('shop_id', shopId).eq('id', pt.id).single();
  return data;
};

export const updatePaperType = async (shopId, id, updates) => {
  const setFields = {};
  if (updates.name !== undefined) setFields.name = updates.name;
  if (updates.nameAr !== undefined) setFields.namear = updates.nameAr;
  if (updates.colorPerPage !== undefined) setFields.colorperpage = updates.colorPerPage;
  if (updates.blackWhitePerPage !== undefined) setFields.blackwhiteperpage = updates.blackWhitePerPage;
  if (updates.sortOrder !== undefined) setFields.sortorder = updates.sortOrder;
  if (Object.keys(setFields).length === 0) return null;
  const { error } = await supabase.from('paper_types').update(setFields).eq('shop_id', shopId).eq('id', id);
  if (error) throw error;
  const { data } = await supabase.from('paper_types').select('*').eq('shop_id', shopId).eq('id', id).single();
  return data;
};

export const deletePaperType = async (shopId, id) => {
  const { error } = await supabase.from('paper_types').delete().eq('shop_id', shopId).eq('id', id);
  if (error) throw error;
  const { data: remaining } = await supabase.from('paper_types').select('id').eq('shop_id', shopId).order('sortorder', { ascending: true });
  for (let i = 0; i < (remaining || []).length; i++) {
    await supabase.from('paper_types').update({ sortorder: i }).eq('shop_id', shopId).eq('id', remaining[i].id);
  }
};

/**
 * Discount Rules Helpers
 */
export const getDiscountRules = async (shopId) => {
  const { data, error } = await supabase.from('discount_rules').select('*').eq('shop_id', shopId).order('priority', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const getActiveDiscountRules = async (shopId) => {
  const { data, error } = await supabase.from('discount_rules').select('*').eq('shop_id', shopId).eq('is_active', 1).order('priority', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const createDiscountRule = async (shopId, rule) => {
  const { id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active } = rule;
  const { error } = await supabase.from('discount_rules').insert({
    id,
    shop_id: shopId,
    name, discount_type,
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

export const updateDiscountRule = async (shopId, id, updates) => {
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

  const { error } = await supabase.from('discount_rules').update(setFields).eq('shop_id', shopId).eq('id', id);
  if (error) throw error;
  return { id, ...updates };
};

export const deleteDiscountRule = async (shopId, id) => {
  const { error } = await supabase.from('discount_rules').delete().eq('shop_id', shopId).eq('id', id);
  if (error) throw error;
  return id;
};

export { supabase as default };

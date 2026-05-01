"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadGeneratedAsset = uploadGeneratedAsset;
const supabaseAdmin_1 = require("../lib/supabaseAdmin");
const bucket = 'lumora-assets';
async function uploadGeneratedAsset(input) {
    const objectPath = `${input.userId}/${Date.now()}-${input.fileName}`;
    const { error } = await supabaseAdmin_1.supabaseAdmin.storage
        .from(bucket)
        .upload(objectPath, input.buffer, {
        contentType: input.contentType,
        upsert: false,
    });
    if (error)
        throw error;
    const { data } = supabaseAdmin_1.supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
    return { objectPath, publicUrl: data.publicUrl };
}

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        // Ambil pilihan model yang sedang aktif (dipakai halaman pengaturan & webhook.js)
        const config = await kv.get('config:ai_model') || {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile'
        };
        return res.status(200).json(config);
    }

    if (req.method === 'POST') {
        const { provider, model, secret } = req.body;

        // Proteksi sederhana supaya tidak sembarang orang bisa ganti model
        if (secret !== process.env.ADMIN_SECRET_KEY) {
            return res.status(401).json({ error: 'Kata sandi salah' });
        }

        if (!provider || !model) {
            return res.status(400).json({ error: 'Provider dan model wajib diisi' });
        }

        await kv.set('config:ai_model', { provider, model });
        return res.status(200).json({ status: 'Tersimpan', provider, model });
    }

    return res.status(405).send('Method Not Allowed');
}

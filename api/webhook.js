export default async function handler(req, res) {
    // ------------------------------------------------------------------------
    // 1. PROSES VERIFIKASI WEBHOOK DARI META (Permintaan GET)
    // ------------------------------------------------------------------------
    if (req.method === 'GET') {
        // Ambil data parameter verifikasi yang dikirim otomatis oleh Meta
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        // Ganti "MY_VERIFY_TOKEN_AUROFA" dengan kata sandi bebas buatan Anda sendiri
        const VERIFY_TOKEN = "MY_VERIFY_TOKEN_AUROFA";

        // Jika Meta mengirimkan mode subscribe dan tokennya cocok
        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('Webhook Aurofa Sukses Terverifikasi oleh Meta!');
                // WAJIB mengembalikan nilai challenge dalam bentuk teks biasa
                return res.status(200).send(challenge);
            } else {
                // Jika token tidak cocok
                return res.status(403).send('Forbidden: Token verifikasi salah.');
            }
        }
        
        return res.status(200).send('Jalur Backend Cloud API Meta Aktif & Siap Diverifikasi!');
    }

    // ------------------------------------------------------------------------
    // 2. PROSES PENGIRIMAN & PENERIMAAN PESAN (Permintaan POST)
    // ------------------------------------------------------------------------
    if (req.method === 'POST') {
        const body = req.body;

        // Pemicu dari tombol di website Anda (index.html)
        if (body && body.aksi === 'kirim_wa') {
            const phoneNumberId = "1742578667091039"; 
            const accessToken = "EAAOJEEVipQ0BR13mGsZBmLRDQPufk5CEZAdaI11MnwoYyZA7ZBrQRu5coJsN8e33XbcW8DtIZCz8de0JenYUyBiAVLqcQLkZCgoerZBKzQe59YclnEWZAsRgvC9ObBAOiXGODoCVcG7Q3YYUoiVSIsjh2xNUZA1C6oyZAwn8ivS81ODZC0hcKZBMe0U9KKox16ZBrUwZDZD";
            const nomorTujuan = "6285650956877"; 

            try {
                const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + accessToken,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: nomorTujuan,
                        type: "template",
                        template: {
                            name: "hello_world",
                            language: { code: "en_US" }
                        }
                    })
                });

                const dataHasil = await response.json();

                if (response.ok) {
                    return res.status(200).json({ status: "Pesan Cloud API Meta berhasil dikirim!" });
                } else {
                    return res.status(500).json({ status: "Gagal dikirim oleh Meta: " + JSON.stringify(dataHasil.error) });
                }
            } catch (err) {
                return res.status(500).json({ status: "Error sistem backend: " + err.message });
            }
        }

        // Tempat masuk log ketika ada orang chat ke WA Anda (Webhook POST resmi dari Meta)
        console.log("Ada pesan WA masuk dari Meta:", JSON.stringify(body, null, 2));
        return res.status(200).json({ status: 'EVENT_RECEIVED' });
    }

    return res.status(405).send('Method Not Allowed');
}

export default async function handler(req, res) {
    // ------------------------------------------------------------------------
    // 1. VERIFIKASI WEBHOOK DARI META (Permintaan GET)
    // ------------------------------------------------------------------------
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const VERIFY_TOKEN = "MY_VERIFY_TOKEN_AUROFA";

        if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        }
        return res.status(200).send('Jalur Webhook Aktif!');
    }

    // ------------------------------------------------------------------------
    // 2. PROSES TERIMA CHAT & BALAS PAKAI GROQ AI (Permintaan POST)
    // ------------------------------------------------------------------------
    if (req.method === 'POST') {
        const body = req.body;

        // Cek apakah ada data pesan masuk resmi dari WhatsApp Meta
        if (body.object === 'whatsapp_business_account' && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            
            // ==================== KONFIGURASI KUNCI UTAMA ====================
            const metaAccessToken = process.env.META_ACCESS_TOKEN;
            const metaPhoneNumberId = "1187789877749779"; // ID Nomor Anda yang tadi
            const groqApiKey = process.env.GROQ_API_KEY; //
            // =================================================================

            const messageData = body.entry[0].changes[0].value.messages[0];
            const nomorPengirim = messageData.from; // Nomor WA Anda yang nge-chat
            const teksMasuk = messageData.text?.body; // Isi chat Anda

            // Jika yang masuk bukan pesan teks (misal gambar/stiker), abaikan agar tidak error
            if (!teksMasuk) {
                return res.status(200).json({ status: 'Bukan pesan teks' });
            }

            try {
                // A. OPER CHAT KE GROQ AI
                const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + groqApiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama3-8b-8192", // Model AI super cepat milik Groq
                        messages: [
                            { role: "system", content: "Kamu adalah Aurora AI Agent. Jawablah pesan customer dengan ramah, singkat, dan solutif." },
                            { role: "user", content: teksMasuk }
                        ]
                    })
                });

                const groqData = await groqResponse.json();
                const jawabanAI = groqData.choices?.[0]?.message?.content || "Maaf, Aurora AI sedang mengalami gangguan teknis.";

                // B. KIRIM BALASAN JAWABAN AI BALIK KE WHATSAPP ANDA
                await fetch(`https://graph.facebook.com/v25.0/${metaPhoneNumberId}/messages`, {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + metaAccessToken,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        recipient_type: "individual",
                        to: nomorPengirim,
                        type: "text",
                        text: { body: jawabanAI }
                    })
                });

                return res.status(200).json({ status: 'Sukses direspon oleh Groq AI' });

            } catch (err) {
                console.error("Gagal memproses AI:", err.message);
                return res.status(500).json({ error: err.message });
            }
        }

        // Ini logika tombol kirim manual website Anda agar tetap berfungsi jika diklik
        if (body && body.aksi === 'kirim_wa') {
            return res.status(200).json({ status: "Fitur tombol manual aktif" });
        }

        return res.status(200).json({ status: 'Event diabaikan' });
    }

    return res.status(405).send('Method Not Allowed');
}

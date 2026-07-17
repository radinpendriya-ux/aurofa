import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // 1. VERIFIKASI WEBHOOK DARI META (Permintaan GET)
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

    // 2. PROSES TERIMA DATA DARI META (Permintaan POST)
    if (req.method === 'POST') {
        const body = req.body;

        console.log("=== DATA MASUK DARI META ===");
        console.log(JSON.stringify(body, null, 2));

        const changeValue = body?.entry?.[0]?.changes?.[0]?.value;

        if (changeValue && changeValue.statuses) {
            console.log("-> Update status pengiriman. Diabaikan.");
            return res.status(200).json({ status: 'Status update diabaikan' });
        }

        if (changeValue && changeValue.messages?.[0]) {
            const messageData = changeValue.messages[0];
            const nomorPengirim = messageData.from;
            const teksMasuk = messageData.text?.body;

            console.log(`-> Chat masuk dari ${nomorPengirim}: "${teksMasuk}"`);

            if (!teksMasuk) {
                console.log("-> Bukan tipe teks. Diabaikan.");
                return res.status(200).json({ status: 'Bukan teks' });
            }

            const metaAccessToken = process.env.META_ACCESS_TOKEN;
            const metaPhoneNumberId = "1187789877749779";
            const groqApiKey = process.env.GROQ_API_KEY;

            const historyKey = `chat_history:${nomorPengirim}`;

            try {
                // A. RESET CHAT KALAU USER KETIK "reset"
                if (teksMasuk.trim().toLowerCase() === 'reset') {
                    await kv.del(historyKey);
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
                            text: { body: "Oke, percakapan sudah direset. Mulai obrolan baru ya!" }
                        })
                    });
                    return res.status(200).json({ status: 'Chat direset' });
                }

                // B. AMBIL HISTORY CHAT SEBELUMNYA
                let history = await kv.get(historyKey) || [];
                console.log(`-> History ditemukan: ${history.length} pesan`);

                // C. TAMBAHKAN PESAN BARU DARI USER
                history.push({ role: "user", content: teksMasuk });

                if (history.length > 10) {
                    history = history.slice(-10);
                }

                // D. TANYA KE GROQ AI DENGAN SELURUH HISTORY
                console.log("-> Menghubungi Groq AI...");
                const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + groqApiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",
                        messages: [
                            { role: "system", content: "Kamu adalah Aurora AI Agent. Jawablah pesan customer dengan ramah, singkat, dan solutif. Ingat konteks percakapan sebelumnya." },
                            ...history
                        ]
                    })
                });

                const groqData = await groqResponse.json();

                if (!groqResponse.ok) {
                    console.error("❌ Groq error:", JSON.stringify(groqData));
                }

                const jawabanAI = groqData.choices?.[0]?.message?.content || "Maaf, Aurora AI sedang mengalami gangguan teknis.";
                console.log("-> Jawaban Groq AI:", jawabanAI);

                // E. TAMBAHKAN JAWABAN AI KE HISTORY, LALU SIMPAN LAGI
                history.push({ role: "assistant", content: jawabanAI });
                await kv.set(historyKey, history);

                // F. BALAS CHAT KE WHATSAPP
                console.log("-> Mengirim balasan ke WhatsApp...");
                const sendWaResponse = await fetch(`https://graph.facebook.com/v25.0/${metaPhoneNumberId}/messages`, {
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

                const sendWaData = await sendWaResponse.json();
                console.log("-> Status Kirim Balasan WhatsApp:", JSON.stringify(sendWaData));

                if (!sendWaResponse.ok) {
                    console.error("❌ Kirim WA gagal:", JSON.stringify(sendWaData));
                    return res.status(200).json({ status: 'Gagal kirim WA', detail: sendWaData });
                }

                return res.status(200).json({ status: 'Sukses' });

            } catch (err) {
                console.error("❌ ERROR PROSES:", err.message);
                return res.status(500).json({ error: err.message });
            }
        }

        return res.status(200).json({ status: 'Format data tidak dikenal/tidak diproses' });
    }

    return res.status(405).send('Method Not Allowed');
}

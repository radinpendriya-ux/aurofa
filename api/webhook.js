import { kv } from '@vercel/kv';

// ================== GOOGLE CALENDAR HELPERS ==================

async function getGoogleAccessToken() {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
    params.append('refresh_token', process.env.GOOGLE_REFRESH_TOKEN);
    params.append('grant_type', 'refresh_token');

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    const data = await response.json();
    if (!response.ok) {
        console.error("❌ Gagal mendapatkan Access Token:", JSON.stringify(data));
        return null;
    }
    return data.access_token;
}

async function buatEventCalendar({ judul, tanggal, jam_mulai, jam_selesai, attendees }) {
    const accessToken = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    const attendeesList = (attendees || []).map(email => ({ email }));

    const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
        {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: judul,
                start: { dateTime: `${tanggal}T${jam_mulai}:00`, timeZone: 'Asia/Jakarta' },
                end: { dateTime: `${tanggal}T${jam_selesai}:00`, timeZone: 'Asia/Jakarta' },
                attendees: attendeesList
            })
        }
    );
    return await response.json();
}

// ================== SCHEMA FUNCTION UNTUK MASING-MASING PROVIDER ==================

// Format schema untuk Groq (gaya OpenAI)
const toolsGroq = [{
    type: "function",
    function: {
        name: "buat_jadwal_calendar",
        description: "Membuat/menjadwalkan event baru di Google Calendar user, bisa juga mengundang peserta lain lewat email",
        parameters: {
            type: "object",
            properties: {
                judul: { type: "string", description: "Judul atau nama acara/meeting" },
                tanggal: { type: "string", description: "Tanggal acara, format YYYY-MM-DD" },
                jam_mulai: { type: "string", description: "Jam mulai, format HH:MM 24 jam" },
                jam_selesai: { type: "string", description: "Jam selesai, format HH:MM 24 jam" },
                attendees: {
                    type: "array",
                    items: { type: "string" },
                    description: "Daftar alamat email peserta yang diundang, kalau disebutkan user"
                }
            },
            required: ["judul", "tanggal", "jam_mulai", "jam_selesai"]
        }
    }
}];

// Format schema untuk Gemini (functionDeclarations)
const toolsGemini = [{
    name: "buat_jadwal_calendar",
    description: "Membuat/menjadwalkan event baru di Google Calendar user, bisa juga mengundang peserta lain lewat email",
    parameters: {
        type: "object",
        properties: {
            judul: { type: "string", description: "Judul atau nama acara/meeting" },
            tanggal: { type: "string", description: "Tanggal acara, format YYYY-MM-DD" },
            jam_mulai: { type: "string", description: "Jam mulai, format HH:MM 24 jam" },
            jam_selesai: { type: "string", description: "Jam selesai, format HH:MM 24 jam" },
            attendees: {
                type: "array",
                items: { type: "string" },
                description: "Daftar alamat email peserta yang diundang, kalau disebutkan user"
            }
        },
        required: ["judul", "tanggal", "jam_mulai", "jam_selesai"]
    }
}];

// ================== PEMANGGIL AI: GROQ ==================

async function panggilGroq(systemPrompt, history, model) {
    const groqApiKey = process.env.GROQ_API_KEY;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + groqApiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "system", content: systemPrompt }, ...history],
            tools: toolsGroq,
            tool_choice: "auto"
        })
    });

    const data = await response.json();
    if (!response.ok) {
        console.error("❌ Groq error:", JSON.stringify(data));
        return { toolCallArgs: null, textReply: null };
    }

    const pesan = data.choices?.[0]?.message;

    if (pesan?.tool_calls?.[0]) {
        try {
            const args = JSON.parse(pesan.tool_calls[0].function.arguments);
            return { toolCallArgs: args, textReply: null };
        } catch (e) {
            console.error("❌ Gagal parse tool_calls Groq:", e.message);
        }
    }

    // Fallback: kadang model kecil menulis function call sebagai teks biasa
    if (pesan?.content && pesan.content.includes('buat_jadwal_calendar')) {
        const jsonMatch = pesan.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const args = JSON.parse(jsonMatch[0]);
                return { toolCallArgs: args, textReply: null };
            } catch (e) { /* biarkan jatuh ke text reply di bawah */ }
        }
    }

    return { toolCallArgs: null, textReply: pesan?.content || null };
}

// ================== PEMANGGIL AI: GEMINI ==================

async function panggilGemini(systemPrompt, history, model) {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    // Ubah history dari format Groq/OpenAI (role: user/assistant) ke format Gemini (role: user/model)
    const contents = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
    }));

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
            method: 'POST',
            headers: {
                'x-goog-api-key': geminiApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: contents,
                tools: [{ functionDeclarations: toolsGemini }]
            })
        }
    );

    const data = await response.json();
    if (!response.ok) {
        console.error("❌ Gemini error:", JSON.stringify(data));
        return { toolCallArgs: null, textReply: null };
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const functionCallPart = parts.find(p => p.functionCall);

    if (functionCallPart) {
        return { toolCallArgs: functionCallPart.functionCall.args, textReply: null };
    }

    const textPart = parts.find(p => p.text);
    return { toolCallArgs: null, textReply: textPart?.text || null };
}

// ================== HANDLER UTAMA ==================

export default async function handler(req, res) {
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

    if (req.method === 'POST') {
        const body = req.body;
        const changeValue = body?.entry?.[0]?.changes?.[0]?.value;

        if (changeValue && changeValue.statuses) {
            return res.status(200).json({ status: 'Status update diabaikan' });
        }

        if (changeValue && changeValue.messages?.[0]) {
            const messageData = changeValue.messages[0];
            const nomorPengirim = messageData.from;
            const teksMasuk = messageData.text?.body;

            if (!teksMasuk) {
                return res.status(200).json({ status: 'Bukan teks' });
            }

            const metaAccessToken = process.env.META_ACCESS_TOKEN;
            const metaPhoneNumberId = "1187789877749779";
            const historyKey = `chat_history:${nomorPengirim}`;

            try {
                if (teksMasuk.trim().toLowerCase() === 'reset') {
                    await kv.del(historyKey);
                    await kirimWA(metaAccessToken, metaPhoneNumberId, nomorPengirim, "Oke, percakapan sudah direset.");
                    return res.status(200).json({ status: 'Chat direset' });
                }

                let history = await kv.get(historyKey) || [];
                history.push({ role: "user", content: teksMasuk });
                if (history.length > 10) history = history.slice(-10);

                const sekarang = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
                const hariIni = new Date(sekarang).toISOString().split('T')[0];

                const systemPromptDasar = process.env.AI_SYSTEM_PROMPT ||
                    "Kamu adalah Aurora AI Agent. Jawab pesan dengan ramah dan singkat.";
                const systemPromptLengkap = `${systemPromptDasar}\n\nHari ini tanggal ${hariIni} (zona waktu Asia/Jakarta).`;

                // AMBIL PROVIDER & MODEL YANG SEDANG DIPILIH DI HALAMAN PENGATURAN
                const aiConfig = await kv.get('config:ai_model') || {
                    provider: 'groq',
                    model: 'llama-3.3-70b-versatile'
                };
                console.log(`-> Memakai provider: ${aiConfig.provider}, model: ${aiConfig.model}`);

                let hasilAI;
                if (aiConfig.provider === 'gemini') {
                    hasilAI = await panggilGemini(systemPromptLengkap, history, aiConfig.model);
                } else {
                    hasilAI = await panggilGroq(systemPromptLengkap, history, aiConfig.model);
                }

                let balasanFinal;

                if (hasilAI.toolCallArgs) {
                    const args = hasilAI.toolCallArgs;
                    console.log("-> AI minta buat jadwal:", args);

                    const hasilCalendar = await buatEventCalendar(args);

                    if (hasilCalendar.id) {
                        const daftarPeserta = (args.attendees && args.attendees.length > 0)
                            ? `\n👥 Mengundang: ${args.attendees.join(', ')}`
                            : '';
                        balasanFinal = `✅ Jadwal berhasil dibuat!\n\n📌 ${args.judul}\n📅 ${args.tanggal}\n⏰ ${args.jam_mulai} - ${args.jam_selesai} WIB${daftarPeserta}`;
                    } else {
                        console.error("❌ Gagal buat event:", JSON.stringify(hasilCalendar));
                        balasanFinal = "Maaf, gagal membuat jadwal di Calendar. Coba lagi ya.";
                    }
                } else {
                    balasanFinal = hasilAI.textReply || "Maaf, Aurora AI sedang mengalami gangguan teknis.";
                }

                history.push({ role: "assistant", content: balasanFinal });
                await kv.set(historyKey, history);

                await kirimWA(metaAccessToken, metaPhoneNumberId, nomorPengirim, balasanFinal);

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

async function kirimWA(token, phoneNumberId, to, teks) {
    const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: teks }
        })
    });
    return await response.json();
}

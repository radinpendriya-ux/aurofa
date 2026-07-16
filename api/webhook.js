export default async function handler(req, res) {
    // Memastikan metode yang masuk adalah POST (standar Webhook)
    if (req.method === 'POST') {
        const dataMasuk = req.body;
        
        // Menampilkan data pesan WA yang masuk di log Vercel
        console.log("Ada pesan WA masuk:", dataMasuk);

        // Berikan respon ke WhatsApp API bahwa data sukses diterima
        return res.status(200).json({ status: 'Success, Webhook diterima Aurofa!' });
    } else {
        // Jika diakses biasa lewat browser (GET)
        return res.status(200).send('Jalur Webhook Aurofa siap menerima data WhatsApp!');
    }
}

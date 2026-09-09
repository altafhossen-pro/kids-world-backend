const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const restoreDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB for restoration');

        const db = mongoose.connection.db;
        const dumpDir = path.join(__dirname, 'db_dump_json');
        
        if (!fs.existsSync(dumpDir)) {
            console.error('db_dump_json folder not found.');
            process.exit(1);
        }

        const files = fs.readdirSync(dumpDir).filter(file => file.endsWith('.json'));

        for (const file of files) {
            const collectionName = file.replace('.json', '');
            const filePath = path.join(dumpDir, file);
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.length > 0) {
                const collection = db.collection(collectionName);
                
                // Clear existing data before restore
                await collection.deleteMany({});
                
                // Recursive function to deeply convert 24-char hex strings to ObjectId
                const convertObjectIds = (obj) => {
                    if (obj === null || typeof obj !== 'object') {
                        if (typeof obj === 'string' && /^[0-9a-fA-F]{24}$/.test(obj)) {
                            return new mongoose.Types.ObjectId(obj);
                        }
                        return obj;
                    }
                    if (Array.isArray(obj)) {
                        return obj.map(item => convertObjectIds(item));
                    }
                    const newObj = {};
                    for (const key in obj) {
                        newObj[key] = convertObjectIds(obj[key]);
                    }
                    return newObj;
                };

                const docs = data.map(doc => convertObjectIds(doc));

                await collection.insertMany(docs);
                console.log(`Restored ${docs.length} documents to ${collectionName}`);
            } else {
                console.log(`Skipped ${collectionName} (no documents)`);
            }
        }

        console.log('Database restoration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error restoring database:', error);
        process.exit(1);
    }
};

restoreDb();

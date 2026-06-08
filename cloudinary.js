const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Buffer dan Cloudinary ga yuklash
async function uploadPhoto(buffer, filename) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'gk-network', resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Ko'p rasmlar
async function uploadPhotos(files) {
  const urls = await Promise.all(
    files.map(f => uploadPhoto(f.buffer, f.originalname))
  );
  return urls;
}

module.exports = { uploadPhotos };

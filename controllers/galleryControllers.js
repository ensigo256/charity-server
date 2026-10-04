const Gallery = require("../models/gallery");
const DeleteImageFromCloudinary = require("../utils/deleteCloudImg");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
exports.createGalleryItem = async (req, res) => {
  try {
    const { title, category, featured, image, imageUrl } = req.body;

    const newGalleryItem = new Gallery({
      title,
      category,
      featured,
      image: imageUrl
        ? { url: imageUrl, public_id: "", size: "unknown" }
        : image || { url: "", public_id: "", size: "unknown" },
    });
    await newGalleryItem.save();

    res.status(201).json(newGalleryItem);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getAllGalleryItems = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [gallery, total] = await Promise.all([
      Gallery.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Gallery.countDocuments(),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(gallery);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.deleteGalleryItem = async (req, res) => {
  try {
    const findGalleryItem = await Gallery.findById(req.params.id);
    if (!findGalleryItem) {
      return res.status(404).json({ message: "Gallery item not found" });
    }
    if (findGalleryItem.image && findGalleryItem.image.public_id) {
      await DeleteImageFromCloudinary(findGalleryItem.image.public_id);
    }
    await Gallery.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Gallery item deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.updateGalleryItem = async (req, res) => {
  try {
    const { title, category } = req.body;
    const findGalleryItem = await Gallery.findById(req.params.id);
    if (!findGalleryItem) {
      return res.status(404).json({ message: "Gallery item not found" });
    }
    findGalleryItem.title = title.trim();
    findGalleryItem.category = category.trim();
    await findGalleryItem.save();
    res
      .status(200)
      .json({ message: "Gallery item updated successfully", findGalleryItem });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

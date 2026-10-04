 
const mongoose = require("mongoose");
 

const blogsSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        excerpt: { type: String, required: true },
        content: { type: String, required: true },
        image: { url: String, public_id: String },
        author: { type: String, required: true },
    category: { type: String, required: true },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    videoId: { type: String },
        comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
        likes: [{ type: String }],
        views: [{ type: String }],
        shares: [{ type: String }],
        publishedOn: { type: Date },
        isFeatured: { type: Boolean, default: false }
        
        
         
    },
  { timestamps: true }
);
blogsSchema.index({ createdAt: -1, _id: -1 });
blogsSchema.index({ status: 1, createdAt: -1, _id: -1 });
const Blogs = mongoose.model("Blog", blogsSchema);

module.exports = Blogs;

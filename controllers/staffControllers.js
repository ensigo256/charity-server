const Staff = require("../models/staff");
const DeleteImage = require("../utils/deleteCloudImg");
const { validationResult } = require("express-validator");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const { pickEditableStaffFields } = require("../utils/staffInput");
// const notifUtil = require('../utils/notificationUtil');

 

exports.createStaff = async (req, res) => {
    try {
        

        const { name, email, phone, role, bio, photo, type, status, socialLinks } =
            pickEditableStaffFields(req.body);

        const newStaff = new Staff({
            name,
            email,
            phone,
            role,
            bio,
            photo: photo || { url: "", public_id: "" },
            type,
            status,
            socialLinks,
        });

        await newStaff.save();

        
        res.status(201).json({
            message: "Staff member created successfully",
            staff: newStaff,
        });

    } catch (error) {
        // logger.error('Staff creation error:', error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.getStaff = async (req, res) => {
    try {
        const pagination = getPagination(req);
        const [staff, total] = await Promise.all([
            Staff.find()
                .sort({ createdAt: -1, _id: -1 })
                .skip(pagination.skip)
                .limit(pagination.limit)
                .select('-__v'),
            Staff.countDocuments(),
        ]);

        if (!staff || staff.length === 0) {
            setPaginationHeaders(res, { ...pagination, total });
            return res.status(200).json([]);
        }

        setPaginationHeaders(res, { ...pagination, total });
        // logger.info(`Retrieved ${staff.length} staff members`);
        res.status(200).json(staff);

    } catch (error) {
        // logger.error('Get staff error:', error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.getPublicStaff = async (_req, res) => {
    try {
        const staff = await Staff.find({ type: "staff", status: "active" })
            .sort({ createdAt: -1, _id: -1 })
            .select("name role bio photo.url")
            .lean();
        return res.status(200).json(staff);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load staff", error: error.message });
    }
};

exports.deleteStaff = async (req, res) => {
    try {
        

        const { id } = req.params;
        const staff = await Staff.findById(id);

        if (!staff) {
            return res.status(404).json({ message: "Staff member not found" });
        }

        // Delete associated photo if exists
        if (staff.photo && staff.photo.public_id) {
             await DeleteImage(staff.photo.public_id);
        }

        await Staff.findByIdAndDelete(id);
 
        // logger.info(`Staff member deleted: ${id} - ${staff.name}`);
        res.status(200).json({ message: "Staff member deleted successfully" });

    } catch (error) {
        // logger.error('Staff deletion error:', error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.updateStaff = async (req, res) => {
    try {
         

        const { id } = req.params;
        const updateData = pickEditableStaffFields(req.body);

        const findStaff = await Staff.findById(id);
        if (!findStaff) {
            return res.status(404).json({ message: "Staff member not found" });
        }
        if (updateData.photo?.public_id && findStaff.photo?.public_id && findStaff.photo.public_id !== updateData.photo.public_id) {
            await DeleteImage(findStaff.photo.public_id);
        }

        const staff = await Staff.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true
        });

        if (!staff) {
            return res.status(404).json({ message: "Staff member not found" });
        }

         
        res.status(200).json({
            message: "Staff member updated successfully",
            staff
        });

    } catch (error) {
        // logger.error('Staff update error:', error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
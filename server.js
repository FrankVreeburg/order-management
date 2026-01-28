// Load environment variables
require("dotenv").config();

// Import Express - the framework for building our web server
const express = require("express");

// Import CORS - allows our frontend (different port) to access this backend
const cors = require("cors");

// Connect to Database PG
const { Pool } = require("pg");

// Import multer for file uploads
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for logo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "./uploads/logos";
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: logo-timestamp.extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "logo-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Only allow images
    const allowedTypes = /jpeg|jpg|png|gif|svg/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, svg)"));
    }
  },
});

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error("❌ Database connection error:", err);
  } else {
    console.log("✅ Connected to PostgreSQL database");
  }
});

// Create an Express application - this is your web server
const app = express();

// Middleware: tells Express to understand JSON data in requests
app.use(express.json());

// Middleware: enables Cross-Origin Resource Sharing
// This allows our React app (localhost:3001) to fetch data from this API (localhost:3000)
app.use(cors());

// Serve static files from uploads directory
app.use("/uploads", express.static("uploads"));

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  const jwt = require("jsonwebtoken");
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user; // Add user info to request
    next();
  });
};

// Middleware to check if user has required role
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
};

// GET /auth/verify - Verify if token is still valid
app.get("/auth/verify", authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user,
  });
});

// ===== API ENDPOINTS =====

// GET /products - returns list of all products with current stock levels
app.get("/products", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /products - creates a new product
app.post("/products", authenticateToken, async (req, res) => {
  const {
    name,
    stock,
    eanCode,
    description,
    category,
    supplier,
    price,
    minStock,
  } = req.body;

  // Validation
  if (!name || stock === undefined) {
    return res.status(400).json({ error: "Name and stock are required" });
  }

  if (stock < 0) {
    return res.status(400).json({ error: "Stock cannot be negative" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (name, stock, ean_code, description, category, supplier, price, min_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        parseInt(stock),
        eanCode || "",
        description || "",
        category || "",
        supplier || "",
        price ? parseFloat(price) : 0,
        minStock ? parseInt(minStock) : 0,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

// PATCH /products/:id - updates a product
app.patch("/products/:id", authenticateToken, async (req, res) => {
  const productId = parseInt(req.params.id);
  const {
    stock,
    name,
    eanCode,
    description,
    category,
    supplier,
    price,
    minStock,
  } = req.body;

  try {
    // Build dynamic UPDATE query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (stock !== undefined && stock !== "") {
      const parsedStock = parseInt(stock);
      if (isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ error: "Invalid stock value" });
      }
      updates.push(`stock = $${paramCount++}`);
      values.push(parsedStock);
    }

    if (name !== undefined && name !== "") {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (eanCode !== undefined) {
      updates.push(`ean_code = $${paramCount++}`);
      values.push(eanCode || null);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description || null);
    }

    if (category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(category || null);
    }

    if (supplier !== undefined) {
      updates.push(`supplier = $${paramCount++}`);
      values.push(supplier || null);
    }

    if (price !== undefined && price !== "") {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ error: "Invalid price value" });
      }
      updates.push(`price = $${paramCount++}`);
      values.push(parsedPrice);
    }

    if (minStock !== undefined && minStock !== "") {
      const parsedMinStock = parseInt(minStock);
      if (isNaN(parsedMinStock) || parsedMinStock < 0) {
        return res.status(400).json({ error: "Invalid minStock value" });
      }
      updates.push(`min_stock = $${paramCount++}`);
      values.push(parsedMinStock);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Add productId as the last parameter
    values.push(productId);

    const query = `
      UPDATE products 
      SET ${updates.join(", ")} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// GET /orders - returns list of all orders
app.get("/orders", authenticateToken, async (req, res) => {
  try {
    const ordersResult = await pool.query(`
     SELECT 
        o.id,
        o.customer_id,
        o.status,
        o.created_at,
        o.assigned_picker_id,
        o.assigned_packer_id,
        o.picked_at,
        o.packed_at,
        o.shipped_at,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company,
        wp.name as picker_name,
        wpack.name as packer_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN workers wp ON o.assigned_picker_id = wp.id
      LEFT JOIN workers wpack ON o.assigned_packer_id = wpack.id
      ORDER BY o.created_at DESC
    `);

    // Get all order items
    const itemsResult = await pool.query(`
      SELECT 
        oi.*
      FROM order_items oi
      ORDER BY oi.order_id, oi.id
    `);

    // Group items by order_id
    const itemsByOrder = {};
    itemsResult.rows.forEach((item) => {
      if (!itemsByOrder[item.order_id]) {
        itemsByOrder[item.order_id] = [];
      }
      itemsByOrder[item.order_id].push(item);
    });

    // Combine orders with their items
    const ordersWithItems = ordersResult.rows.map((order) => ({
      ...order,
      items: itemsByOrder[order.id] || [],
    }));

    res.json(ordersWithItems);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// POST /orders - creates a new order with multiple items
app.post("/orders", authenticateToken, async (req, res) => {
  const { customerId, items } = req.body;

  // Validation
  if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ error: "Customer ID and at least one item are required" });
  }

  try {
    // Start a transaction (ensures all-or-nothing: either order is created AND stock updated, or neither happens)
    await pool.query("BEGIN");

    // Verify customer exists
    const customerResult = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [customerId],
    );

    if (customerResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customerResult.rows[0];

    // Create the order
    const orderResult = await pool.query(
      `INSERT INTO orders (customer_id, customer_name, status, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [customerId, customer.name, "pending"],
    );

    const order = orderResult.rows[0];

    // Process each item
    const orderItems = [];
    for (const item of items) {
      const { productId, quantity } = item;

      if (!productId || !quantity || quantity <= 0) {
        await pool.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Invalid item: productId and quantity > 0 required" });
      }

      // Get product and lock for update
      const productResult = await pool.query(
        "SELECT * FROM products WHERE id = $1 FOR UPDATE",
        [productId],
      );

      if (productResult.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: `Product not found: ${productId}` });
      }

      const product = productResult.rows[0];

      // Check stock
      if (product.stock < quantity) {
        await pool.query("ROLLBACK");
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${quantity}`,
        });
      }

      // Create order item
      const itemResult = await pool.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_order, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *`,
        [order.id, productId, product.name, quantity, product.price || 0],
      );

      orderItems.push(itemResult.rows[0]);

      // Update product stock
      await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
        quantity,
        productId,
      ]);
    }

    await pool.query("COMMIT");

    // Return order with items
    res.status(201).json({
      ...order,
      items: orderItems,
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// GET /orders/:id - get single order with items
app.get("/orders/:id", authenticateToken, async (req, res) => {
  const orderId = parseInt(req.params.id);

  try {
    // Get order
    const orderResult = await pool.query(
      `
      SELECT 
        o.*,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company,
        c.phone as customer_phone,
        c.address as customer_address,
        wp.name as picker_name,
        wp.email as picker_email,
        wpack.name as packer_name,
        wpack.email as packer_email
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN workers wp ON o.assigned_picker_id = wp.id
      LEFT JOIN workers wpack ON o.assigned_packer_id = wpack.id
      WHERE o.id = $1
    `,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Get order items
    const itemsResult = await pool.query(
      `
      SELECT * FROM order_items WHERE order_id = $1 ORDER BY id
    `,
      [orderId],
    );

    res.json({
      ...orderResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// PATCH /orders/:id - updates an order's status
app.patch("/orders/:id", authenticateToken, async (req, res) => {
  const orderId = parseInt(req.params.id);
  const { status, assignedPickerId, assignedPackerId } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Update status
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);

      // Set timestamps based on status
      if (status === "picked") {
        updates.push(`picked_at = NOW()`);
      } else if (status === "packed") {
        updates.push(`packed_at = NOW()`);
      } else if (status === "shipped") {
        updates.push(`shipped_at = NOW()`);
      }
    }

    // Assign picker
    if (assignedPickerId !== undefined) {
      updates.push(`assigned_picker_id = $${paramCount++}`);
      values.push(assignedPickerId);
    }

    // Assign packer
    if (assignedPackerId !== undefined) {
      updates.push(`assigned_packer_id = $${paramCount++}`);
      values.push(assignedPackerId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(orderId);

    const query = `
      UPDATE orders 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    await pool.query(query, values);

    // Fetch the updated order with all JOIN data
    const result = await pool.query(
      `
      SELECT 
        o.*,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company,
        wp.name as picker_name,
        wpack.name as packer_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN workers wp ON o.assigned_picker_id = wp.id
      LEFT JOIN workers wpack ON o.assigned_packer_id = wpack.id
      WHERE o.id = $1
    `,
      [orderId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Get items
    const itemsResult = await pool.query(
      `
      SELECT * FROM order_items WHERE order_id = $1 ORDER BY id
    `,
      [orderId],
    );

    res.json({
      ...result.rows[0],
      items: itemsResult.rows,
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// POST /orders/:id/items - Add item to existing order (only if pending)
app.post("/orders/:id/items", authenticateToken, async (req, res) => {
  const orderId = parseInt(req.params.id);
  const { productId, quantity } = req.body;

  if (!productId || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ error: "Product ID and quantity > 0 required" });
  }

  try {
    await pool.query("BEGIN");

    // Check order exists and is pending
    const orderCheck = await pool.query("SELECT * FROM orders WHERE id = $1", [
      orderId,
    ]);

    if (orderCheck.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found" });
    }

    if (orderCheck.rows[0].status !== "pending") {
      await pool.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Can only add items to pending orders" });
    }

    // Get product and check stock
    const productResult = await pool.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [productId],
    );

    if (productResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }

    const product = productResult.rows[0];

    if (product.stock < quantity) {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        error: `Insufficient stock. Available: ${product.stock}`,
      });
    }

    // Add item to order
    const itemResult = await pool.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, price_at_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orderId, productId, product.name, quantity, product.price || 0],
    );

    // Update product stock
    await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
      quantity,
      productId,
    ]);

    await pool.query("COMMIT");

    res.status(201).json(itemResult.rows[0]);
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to add item to order" });
  }
});

// PATCH /orders/:orderId/items/:itemId - Update item quantity (only if pending)
app.patch(
  "/orders/:orderId/items/:itemId",
  authenticateToken,
  async (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const itemId = parseInt(req.params.itemId);
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be greater than 0" });
    }

    try {
      await pool.query("BEGIN");

      // Check order is pending
      const orderCheck = await pool.query(
        "SELECT * FROM orders WHERE id = $1",
        [orderId],
      );

      if (orderCheck.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ error: "Order not found" });
      }

      if (orderCheck.rows[0].status !== "pending") {
        await pool.query("ROLLBACK");
        return res.status(400).json({ error: "Can only edit pending orders" });
      }

      // Get current item
      const itemResult = await pool.query(
        "SELECT * FROM order_items WHERE id = $1 AND order_id = $2",
        [itemId, orderId],
      );

      if (itemResult.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ error: "Order item not found" });
      }

      const item = itemResult.rows[0];
      const oldQuantity = item.quantity;
      const quantityDiff = quantity - oldQuantity;

      // Get product and check stock
      const productResult = await pool.query(
        "SELECT * FROM products WHERE id = $1 FOR UPDATE",
        [item.product_id],
      );

      const product = productResult.rows[0];

      // If increasing quantity, check stock
      if (quantityDiff > 0 && product.stock < quantityDiff) {
        await pool.query("ROLLBACK");
        return res.status(400).json({
          error: `Insufficient stock. Available: ${product.stock}`,
        });
      }

      // Update item quantity
      const updatedItem = await pool.query(
        "UPDATE order_items SET quantity = $1 WHERE id = $2 RETURNING *",
        [quantity, itemId],
      );

      // Adjust product stock (negative if reducing order, positive if increasing)
      await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
        quantityDiff,
        item.product_id,
      ]);

      await pool.query("COMMIT");

      res.json(updatedItem.rows[0]);
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to update order item" });
    }
  },
);

// DELETE /orders/:orderId/items/:itemId - Remove item from order (only if pending)
app.delete(
  "/orders/:orderId/items/:itemId",
  authenticateToken,
  async (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const itemId = parseInt(req.params.itemId);

    try {
      await pool.query("BEGIN");

      // Check order is pending
      const orderCheck = await pool.query(
        "SELECT * FROM orders WHERE id = $1",
        [orderId],
      );

      if (orderCheck.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ error: "Order not found" });
      }

      if (orderCheck.rows[0].status !== "pending") {
        await pool.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Can only remove items from pending orders" });
      }

      // Check there's more than one item (can't remove all items)
      const itemCount = await pool.query(
        "SELECT COUNT(*) FROM order_items WHERE order_id = $1",
        [orderId],
      );

      if (parseInt(itemCount.rows[0].count) <= 1) {
        await pool.query("ROLLBACK");
        return res.status(400).json({
          error: "Cannot remove last item. Delete the order instead.",
        });
      }

      // Get item to restore stock
      const itemResult = await pool.query(
        "SELECT * FROM order_items WHERE id = $1 AND order_id = $2",
        [itemId, orderId],
      );

      if (itemResult.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ error: "Order item not found" });
      }

      const item = itemResult.rows[0];

      // Restore stock
      await pool.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [
        item.quantity,
        item.product_id,
      ]);

      // Delete item
      await pool.query("DELETE FROM order_items WHERE id = $1", [itemId]);

      await pool.query("COMMIT");

      res.json({ message: "Item removed successfully", itemId });
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to remove order item" });
    }
  },
);

// ===== WORKER ENDPOINTS =====

// GET /workers - get all workers
app.get("/workers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        w.*,
        u.username,
        u.email as user_email
      FROM workers w
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch workers" });
  }
});

// POST /workers - create a new worker
app.post("/workers", authenticateToken, async (req, res) => {
  const { name, email, role, phone, userId } = req.body;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  try {
    // Check if email already exists
    const existingWorker = await pool.query(
      "SELECT * FROM workers WHERE email = $1",
      [email],
    );

    if (existingWorker.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // If userId provided, verify user exists and isn't already linked
    if (userId) {
      const userCheck = await pool.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user is already linked to another worker
      const existingLink = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1",
        [userId],
      );

      if (existingLink.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "User already linked to another worker" });
      }
    }

    // Create new worker
    const result = await pool.query(
      `INSERT INTO workers (name, email, role, phone, active, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, email, role || "Picker", phone || "", true, userId || null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create worker" });
  }
});

// PATCH /workers/:id - update a worker
app.patch("/workers/:id", authenticateToken, async (req, res) => {
  const workerId = parseInt(req.params.id);
  const { name, email, role, phone, active, userId } = req.body;

  try {
    // Check if email is being changed and if it already exists
    if (email) {
      const existingWorker = await pool.query(
        "SELECT * FROM workers WHERE email = $1 AND id != $2",
        [email, workerId],
      );

      if (existingWorker.rows.length > 0) {
        return res.status(400).json({ error: "Email already exists" });
      }
    }

    // If userId is being changed, verify user exists and isn't already linked
    if (userId !== undefined && userId !== null) {
      const userCheck = await pool.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user is already linked to another worker
      const existingLink = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1 AND id != $2",
        [userId, workerId],
      );

      if (existingLink.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "User already linked to another worker" });
      }
    }

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramCount++}`);
      values.push(active);
    }
    if (userId !== undefined) {
      // Allow setting to null to unlink
      updates.push(`user_id = $${paramCount++}`);
      values.push(userId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(workerId);

    const query = `
      UPDATE workers 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    await pool.query(query, values);

    // Fetch the updated worker WITH user info (using JOIN)
    const result = await pool.query(
      `
      SELECT 
        w.*,
        u.username,
        u.email as user_email
      FROM workers w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.id = $1
    `,
      [workerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update worker" });
  }
});

// DELETE /workers/:id - delete a worker
app.delete(
  "/workers/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      // Check if user is linked to a worker
      const linkedWorker = await pool.query(
        "SELECT * FROM workers WHERE user_id = $1",
        [userId],
      );

      if (linkedWorker.rows.length > 0) {
        return res.status(400).json({
          error: `Cannot delete user. Linked to worker: ${linkedWorker.rows[0].name}. Unlink the worker first.`,
        });
      }

      const result = await pool.query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "User deleted successfully", id: userId });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

// ===== SETTINGS ENDPOINTS =====

// GET /settings - Get all settings or by category
app.get("/settings", authenticateToken, async (req, res) => {
  const { category } = req.query;

  try {
    let query = "SELECT * FROM settings";
    const params = [];

    if (category) {
      query += " WHERE category = $1";
      params.push(category);
    }

    query += " ORDER BY category, setting_key";

    const result = await pool.query(query, params);

    // Convert to key-value object for easier frontend use
    const settingsObj = {};
    result.rows.forEach((row) => {
      let value = row.setting_value;

      // Parse value based on type
      if (row.setting_type === "boolean") {
        value = value === "true";
      } else if (row.setting_type === "number") {
        value = parseFloat(value);
      } else if (row.setting_type === "json") {
        try {
          value = JSON.parse(value);
        } catch (e) {
          console.error("Error parsing JSON setting:", row.setting_key);
        }
      }

      settingsObj[row.setting_key] = {
        value: value,
        type: row.setting_type,
        category: row.category,
        description: row.description,
        updated_at: row.updated_at,
      };
    });

    res.json(settingsObj);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// GET /settings/:key - Get single setting by key
app.get("/settings/:key", authenticateToken, async (req, res) => {
  const { key } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM settings WHERE setting_key = $1",
      [key],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Setting not found" });
    }

    const setting = result.rows[0];
    let value = setting.setting_value;

    // Parse value based on type
    if (setting.setting_type === "boolean") {
      value = value === "true";
    } else if (setting.setting_type === "number") {
      value = parseFloat(value);
    } else if (setting.setting_type === "json") {
      try {
        value = JSON.parse(value);
      } catch (e) {
        console.error("Error parsing JSON setting:", key);
      }
    }

    res.json({
      key: setting.setting_key,
      value: value,
      type: setting.setting_type,
      category: setting.category,
      description: setting.description,
      updated_at: setting.updated_at,
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch setting" });
  }
});

// PATCH /settings - Update multiple settings (admin only)
app.patch(
  "/settings",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const { settings } = req.body; // Expecting { settings: { key1: value1, key2: value2, ... } }

    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Settings object is required" });
    }

    try {
      await pool.query("BEGIN");

      const updatedSettings = [];

      for (const [key, value] of Object.entries(settings)) {
        // Convert value to string for storage
        let stringValue = value;
        if (typeof value === "object") {
          stringValue = JSON.stringify(value);
        } else if (typeof value === "boolean") {
          stringValue = value.toString();
        } else {
          stringValue = String(value);
        }

        const result = await pool.query(
          `UPDATE settings 
         SET setting_value = $1, updated_at = NOW(), updated_by = $2
         WHERE setting_key = $3
         RETURNING *`,
          [stringValue, req.user.userId, key],
        );

        if (result.rows.length > 0) {
          updatedSettings.push(result.rows[0]);
        }
      }

      await pool.query("COMMIT");

      res.json({
        message: "Settings updated successfully",
        updated: updatedSettings.length,
        settings: updatedSettings,
      });
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  },
);

// POST /settings/logo - Upload company logo (admin only)
app.post(
  "/settings/logo",
  authenticateToken,
  requireRole("admin"),
  upload.single("logo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Generate URL for the uploaded file
      const logoUrl = `/uploads/logos/${req.file.filename}`;

      // Delete old logo if exists
      const oldLogoResult = await pool.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'company_logo_url'",
      );

      if (
        oldLogoResult.rows.length > 0 &&
        oldLogoResult.rows[0].setting_value
      ) {
        const oldLogoPath = "." + oldLogoResult.rows[0].setting_value;
        if (fs.existsSync(oldLogoPath)) {
          fs.unlinkSync(oldLogoPath);
          console.log("Deleted old logo:", oldLogoPath);
        }
      }

      // Update settings with new logo URL
      await pool.query(
        `UPDATE settings 
       SET setting_value = $1, updated_at = NOW(), updated_by = $2
       WHERE setting_key = 'company_logo_url'`,
        [logoUrl, req.user.userId],
      );

      res.json({
        message: "Logo uploaded successfully",
        url: logoUrl,
        filename: req.file.filename,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  },
);

// DELETE /settings/logo - Remove company logo (admin only)
app.delete(
  "/settings/logo",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      // Get current logo
      const result = await pool.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'company_logo_url'",
      );

      if (result.rows.length > 0 && result.rows[0].setting_value) {
        const logoPath = "." + result.rows[0].setting_value;

        // Delete file from filesystem
        if (fs.existsSync(logoPath)) {
          fs.unlinkSync(logoPath);
          console.log("Deleted logo:", logoPath);
        }

        // Clear logo URL in database
        await pool.query(
          `UPDATE settings 
         SET setting_value = NULL, updated_at = NOW(), updated_by = $1
         WHERE setting_key = 'company_logo_url'`,
          [req.user.userId],
        );

        res.json({ message: "Logo deleted successfully" });
      } else {
        res.status(404).json({ error: "No logo found" });
      }
    } catch (error) {
      console.error("Delete error:", error);
      res.status(500).json({ error: "Failed to delete logo" });
    }
  },
);

// ===== CUSTOMER ENDPOINTS =====

// GET /customers - Get all customers
app.get("/customers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

// GET /customers/:id/orders - Get all orders for a specific customer
app.get("/customers/:id/orders", authenticateToken, async (req, res) => {
  const customerId = parseInt(req.params.id);

  try {
    // Get customer info
    const customerResult = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [customerId],
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Get all orders for this customer
    const ordersResult = await pool.query(
      `
      SELECT 
        o.*
      FROM orders o
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC
    `,
      [customerId],
    );

    // Get order items for all these orders
    if (ordersResult.rows.length > 0) {
      const orderIds = ordersResult.rows.map((o) => o.id);
      const itemsResult = await pool.query(
        `
        SELECT * FROM order_items 
        WHERE order_id = ANY($1)
        ORDER BY order_id, id
      `,
        [orderIds],
      );

      // Group items by order_id
      const itemsByOrder = {};
      itemsResult.rows.forEach((item) => {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = [];
        }
        itemsByOrder[item.order_id].push(item);
      });

      // Combine orders with their items
      const ordersWithItems = ordersResult.rows.map((order) => ({
        ...order,
        items: itemsByOrder[order.id] || [],
      }));

      res.json({
        customer: customerResult.rows[0],
        orders: ordersWithItems,
      });
    } else {
      res.json({
        customer: customerResult.rows[0],
        orders: [],
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch customer orders" });
  }
});

// POST /customers - Create new customer
app.post("/customers", authenticateToken, async (req, res) => {
  const { name, email, phone, company, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Customer name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, email, phone, company, address)
      VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, email || null, phone || null, company || null, address || null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// PATCH /customers/:id - Update customer
app.patch("/customers/:id", authenticateToken, async (req, res) => {
  const customerId = parseInt(req.params.id);
  const { name, email, phone, company, address } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (company !== undefined) {
      updates.push(`company = $${paramCount++}`);
      values.push(company);
    }
    if (address !== undefined) {
      updates.push(`address = $${paramCount++}`);
      values.push(address);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(customerId);

    const query = `
      UPDATE customers 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// ===== USER MANAGEMENT ENDPOINTS (Admin only) =====

// GET /users - Get all users (admin only)
app.get("/users", authenticateToken, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role, created_at FROM users ORDER BY id",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// PATCH /users/:id - Update user (admin only)
app.patch(
  "/users/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);
    const { username, email, role } = req.body;

    try {
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (username !== undefined) {
        updates.push(`username = $${paramCount++}`);
        values.push(username);
      }
      if (email !== undefined) {
        updates.push(`email = $${paramCount++}`);
        values.push(email);
      }
      if (role !== undefined) {
        updates.push(`role = $${paramCount++}`);
        values.push(role);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      values.push(userId);

      const query = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, username, email, role, created_at
    `;

      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

// DELETE /users/:id - Delete user (admin only)
app.delete(
  "/users/:id",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      const result = await pool.query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "User deleted successfully", id: userId });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

// ===== AUTHENTICATION ENDPOINTS =====

// POST /auth/register - Create new user account
app.post("/auth/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  // Validation
  if (!username || !email || !password) {
    return res
      .status(400)
      .json({ error: "Username, email, and password are required" });
  }

  if (password.length < 9) {
    return res
      .status(400)
      .json({ error: "Password must be at least 9 characters" });
  }

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username],
    );

    if (existingUser.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Email or username already exists" });
    }

    // Hash the password
    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash, role || "user"],
    );

    res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// POST /auth/login - Login user
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Find user
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // Check password
    const bcrypt = require("bcryptjs");
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Create JWT token
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Start the server and listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});

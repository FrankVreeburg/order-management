// Import Express - the framework for building our web server
const express = require("express");

// Import CORS - allows our frontend (different port) to access this backend
const cors = require("cors");

// Create an Express application - this is your web server
const app = express();

// Middleware: tells Express to understand JSON data in requests
app.use(express.json());

// Middleware: enables Cross-Origin Resource Sharing
// This allows our React app (localhost:3001) to fetch data from this API (localhost:3000)
app.use(cors());

// In-memory storage (data disappears when server restarts - we'll fix this with a database later)
let orders = [];
let products = [
  {
    id: 1,
    name: "Widget A",
    stock: 100,
    eanCode: "8712345678901",
    description: "High-quality widget for industrial use",
    category: "Widgets",
    supplier: "ABC Supplies",
    price: 29.99,
    minStock: 20,
  },
  {
    id: 2,
    name: "Widget B",
    stock: 50,
    eanCode: "8712345678902",
    description: "Compact widget for light-duty applications",
    category: "Widgets",
    supplier: "XYZ Corp",
    price: 19.99,
    minStock: 10,
  },
];
let workers = [
  {
    id: 1,
    name: "John Smith",
    email: "john@example.com",
    role: "Picker",
    phone: "555-0101",
    active: true,
  },
  {
    id: 2,
    name: "Jane Doe",
    email: "jane@example.com",
    role: "Supervisor",
    phone: "555-0102",
    active: true,
  },
];

// ===== API ENDPOINTS =====

// GET /products - returns list of all products with current stock levels
app.get("/products", (req, res) => {
  res.json(products);
});

// GET /orders - returns list of all orders
app.get("/orders", (req, res) => {
  res.json(orders);
});

// POST /orders - creates a new order
// Expects JSON body with: productId, quantity, customerName
app.post("/orders", (req, res) => {
  const { productId, quantity, customerName } = req.body;

  // Find the requested product in our inventory
  const product = products.find((p) => p.id === productId);

  // Validation: check if product exists
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  // Validation: check if we have enough stock
  if (product.stock < quantity) {
    return res.status(400).json({ error: "Insufficient stock" });
  }

  // Create new order object
  const newOrder = {
    id: orders.length + 1,
    productId,
    productName: product.name,
    quantity,
    customerName,
    status: "pending",
    createdAt: new Date(),
  };

  // Deduct ordered quantity from inventory
  product.stock -= quantity;

  // Add order to our orders array
  orders.push(newOrder);

  // Send back the created order with 201 (Created) status
  res.status(201).json(newOrder);
});

// PATCH /orders/:id - updates an order's status
app.patch("/orders/:id", (req, res) => {
  const orderId = parseInt(req.params.id); // Get order ID from URL
  const { status } = req.body; // Get new status from request body

  // Find the order
  const order = orders.find((o) => o.id === orderId);

  // Check if order exists
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Update the status
  order.status = status;

  // Send back the updated order
  res.json(order);
});

// POST /products - creates a new product
app.post("/products", (req, res) => {
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

  // Create new product with all fields
  const newProduct = {
    id: products.length > 0 ? Math.max(...products.map((p) => p.id)) + 1 : 1,
    name,
    stock: parseInt(stock),
    eanCode: eanCode || "",
    description: description || "",
    category: category || "",
    supplier: supplier || "",
    price: price ? parseFloat(price) : 0,
    minStock: minStock ? parseInt(minStock) : 0,
  };

  // Add to products array
  products.push(newProduct);

  // Return the created product
  res.status(201).json(newProduct);
});

// PATCH /products/:id - updates a product's stock
app.patch("/products/:id", (req, res) => {
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

  // Find the product
  const product = products.find((p) => p.id === productId);

  // Check if product exists
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  // Update fields (only if provided)
  if (stock !== undefined) {
    if (stock < 0) {
      return res.status(400).json({ error: "Stock cannot be negative" });
    }
    product.stock = parseInt(stock);
  }

  if (name !== undefined) product.name = name;
  if (eanCode !== undefined) product.eanCode = eanCode;
  if (description !== undefined) product.description = description;
  if (category !== undefined) product.category = category;
  if (supplier !== undefined) product.supplier = supplier;
  if (price !== undefined) product.price = parseFloat(price);
  if (minStock !== undefined) product.minStock = parseInt(minStock);

  // Send back the updated product
  res.json(product);
});

// ===== WORKER ENDPOINTS =====

// GET /workers - get all workers
app.get("/workers", (req, res) => {
  res.json(workers);
});

// POST /workers - create a new worker
app.post("/workers", (req, res) => {
  const { name, email, role, phone } = req.body;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Check if email already exists
  if (workers.find((w) => w.email === email)) {
    return res.status(400).json({ error: "Email already exists" });
  }

  const newWorker = {
    id: workers.length > 0 ? Math.max(...workers.map((w) => w.id)) + 1 : 1,
    name,
    email,
    role: role || "Picker",
    phone: phone || "",
    active: true,
  };

  workers.push(newWorker);
  res.status(201).json(newWorker);
});

// PATCH /workers/:id - update a worker
app.patch("/workers/:id", (req, res) => {
  const workerId = parseInt(req.params.id);
  const { name, email, role, phone, active } = req.body;

  const worker = workers.find((w) => w.id === workerId);

  if (!worker) {
    return res.status(404).json({ error: "Worker not found" });
  }

  // Check email uniqueness if changing email
  if (email && email !== worker.email) {
    if (workers.find((w) => w.email === email && w.id !== workerId)) {
      return res.status(400).json({ error: "Email already exists" });
    }
  }

  // Update fields
  if (name !== undefined) worker.name = name;
  if (email !== undefined) worker.email = email;
  if (role !== undefined) worker.role = role;
  if (phone !== undefined) worker.phone = phone;
  if (active !== undefined) worker.active = active;

  res.json(worker);
});

// DELETE /workers/:id - delete a worker
app.delete("/workers/:id", (req, res) => {
  const workerId = parseInt(req.params.id);
  const index = workers.findIndex((w) => w.id === workerId);

  if (index === -1) {
    return res.status(404).json({ error: "Worker not found" });
  }

  workers.splice(index, 1);
  res.json({ message: "Worker deleted successfully", id: workerId });
});

// Start the server and listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});

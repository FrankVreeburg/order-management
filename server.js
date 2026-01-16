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
  { id: 1, name: "Widget A", stock: 100 },
  { id: 2, name: "Widget B", stock: 50 },
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
  const { name, stock } = req.body;

  // Validation
  if (!name || stock === undefined) {
    return res.status(400).json({ error: "Name and stock are required" });
  }

  if (stock < 0) {
    return res.status(400).json({ error: "Stock cannot be negative" });
  }

  // Create new product
  const newProduct = {
    id: products.length > 0 ? Math.max(...products.map((p) => p.id)) + 1 : 1,
    name,
    stock: parseInt(stock),
  };

  // Add to products array
  products.push(newProduct);

  // Return the created product
  res.status(201).json(newProduct);
});

// Start the server and listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Ready to take orders! 📦");
});

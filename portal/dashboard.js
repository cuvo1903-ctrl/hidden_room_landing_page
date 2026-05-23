const user = localStorage.getItem("user");

if (!user) {
  window.location.href = "./login.html";
}

const user = JSON.parse(localStorage.getItem("user"));

document.getElementById("username-display").textContent =
  user.username;
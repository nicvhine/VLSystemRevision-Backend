// Generate a unique borrower username from full name
async function generateBorrowerUsername(name, borrowersCollection) {
    const parts = name.trim().toLowerCase().split(" ");
    if (parts.length < 2) return null;
  
    let baseUsername = parts[0].slice(0, 3) + parts[parts.length - 1];
    let username = baseUsername;
    let count = 1;
  
    while (await borrowersCollection.findOne({ username })) {
      count++;
      username = baseUsername + count;
    }
  
    return username;
  }


// Generate a unique staff username based on role and first name
async function generateStaffUsername(name, role, usersRepo) {
  const firstName = name.trim().split(" ")[0].toLowerCase();  
  const base = `${role.toLowerCase().replace(/\s+/g, '')}${firstName}`;
  
  let username = base;
  let count = 1;

  while (await usersRepo.findByUsername(username)) {
    count++;
    username = `${base}${count}`;
  }

  return username;
}


  
  module.exports = { generateBorrowerUsername, generateStaffUsername };
  
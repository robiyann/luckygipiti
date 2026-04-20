function generateRandomName() {
  const a = [
    "James", "John", "Robert", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Charles",
    "Daniel", "Matthew", "Anthony", "Mark", "Steven", "Andrew", "Paul", "Joshua", "Kenneth", "Kevin",
    "Brian", "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey", "Ryan", "Jacob", "Gary",
    "Nicholas", "Eric", "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan",
    "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Margaret", "Sandra", "Ashley", "Emily",
    "Donna", "Michelle", "Dorothy", "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca",
    "Sharon", "Laura", "Cynthia", "Kathleen", "Amy", "Angela"
  ];
  const b = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
    "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
    "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
    "Phillips", "Evans", "Turner", "Parker", "Collins", "Edwards", "Stewart", "Morris", "Murphy", "Cook",
    "Rogers", "Morgan", "Cooper"
  ];
  const c = a[Math.floor(Math.random() * a.length)];
  const d = b[Math.floor(Math.random() * b.length)];
  return c + " " + d;
}

function generateRandomBirthday() {
  const a = (Math.floor(Math.random() * 12) + 1).toString().padStart(2, "0");
  const b = (Math.floor(Math.random() * 28) + 1).toString().padStart(2, "0");
  const c = (Math.floor(Math.random() * (2000 - 1980 + 1)) + 1980).toString();
  return { month: a, day: b, year: c, full: c + "-" + a + "-" + b };
}

module.exports = {
  generateRandomName,
  generateRandomBirthday,
};

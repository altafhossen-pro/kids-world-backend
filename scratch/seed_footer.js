const mongoose = require('mongoose');
const { Menu } = require('../src/modules/menu/menu.model');
require('dotenv').config({ path: '../.env' });

const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        // Delete existing footer menus to re-seed
        await Menu.deleteMany({ type: 'footer' });
        console.log('Deleted old footer menus');

        const fallbackFooterData = {
            quickLinks: [
              { name: "Home", href: "/", isActive: true },
              { name: "Shop All Toys", href: "/shop", isActive: true },
              { name: "New Arrivals", href: "/new-arrivals", isActive: true },
              { name: "Best Sellers", href: "/best-sellers", isActive: true },
              { name: "Our Blog", href: "/blogs", isActive: true }
            ],
            utilities: [
              { name: "About Us", href: "/about-us", isActive: true },
              { name: "Contact Us", href: "/contact-us", isActive: true },
              { name: "Privacy Policy", href: "/privacy-policy", isActive: true },
              { name: "Terms & Conditions", href: "/terms-and-conditions", isActive: true },
              { name: "Return Policy", href: "/return-policy", isActive: true }
            ],
            contact: [
              { type: 'address', href: 'Jamuna Future Park Level 1 DNCC corner A-1-013 (Near West Court), Gulshan DNCC Market shop number 66', label: 'Jamuna Branch', isActive: true },
              { type: 'phone', href: '01633075357', label: 'Phone', isActive: true },
              { type: 'phone', href: '01793596476', label: 'Phone 2', isActive: true },
              { type: 'email', href: 'kidsworld6476@gmail.com', label: 'Email', isActive: true }
            ],
            socialMedia: [
              { platform: 'facebook', href: 'https://facebook.com', isActive: true },
              { platform: 'instagram', href: 'https://instagram.com', isActive: true },
              { platform: 'twitter', href: 'https://twitter.com', isActive: true }
            ]
        };

        const menuItems = [];

        // Quick Links
        fallbackFooterData.quickLinks.forEach((item, index) => {
            menuItems.push({ type: 'footer', section: 'quickLinks', name: item.name, href: item.href, isActive: item.isActive, order: index });
        });

        // Utilities
        fallbackFooterData.utilities.forEach((item, index) => {
            menuItems.push({ type: 'footer', section: 'utilities', name: item.name, href: item.href, isActive: item.isActive, order: index });
        });

        // Contact
        fallbackFooterData.contact.forEach((item, index) => {
            menuItems.push({ type: 'footer', section: 'contact', name: item.label, href: item.href, isActive: item.isActive, order: index, contactType: item.type });
        });

        // Social Media
        fallbackFooterData.socialMedia.forEach((item, index) => {
            menuItems.push({ type: 'footer', section: 'socialMedia', name: item.platform.charAt(0).toUpperCase() + item.platform.slice(1), href: item.href, isActive: item.isActive, order: index, socialPlatform: item.platform });
        });

        await Menu.insertMany(menuItems);
        console.log('Seed complete with NewFooter data!');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};

seedData();
